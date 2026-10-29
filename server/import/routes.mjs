import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { HttpError, json, readJsonBody } from "./http.mjs";
import { parseCookies, validateCsrf, validateOrigin } from "./security.mjs";
import { receiveHtmlUpload } from "./upload.mjs";
import { extractPeriod, loadPeriodCuration } from "./pipeline.mjs";
import { canApproveDraft } from "./merge-draft.mjs";
import { transitionImport } from "./state-machine.mjs";
import { diffSnapshots } from "./diff.mjs";
import { listReleases, loadPublishedSnapshot, publishDraft, rollbackRelease, snapshotFromDraft } from "./publish.mjs";

function secure(req, config) {
  // 未配置来源时的 403 必须说明原因，否则运维只能看到一个空洞的 ORIGIN_DENIED
  if (!config.originConfigured) throw new HttpError(403, "ORIGIN_NOT_CONFIGURED", "未配置 AI_COCKPIT_ORIGIN，管理台写操作已被安全策略禁用");
  if (!validateOrigin(req.headers.origin, config)) throw new HttpError(403, "ORIGIN_DENIED", "请求来源不受信任");
  const cookies = parseCookies(req.headers.cookie);
  if (!validateCsrf({ cookieToken: cookies.ai_cockpit_csrf, headerToken: req.headers["x-csrf-token"] })) throw new HttpError(403, "CSRF_DENIED", "请求校验失败");
}

/** 读请求不需要 CSRF 令牌，但跨站发起的请求必带 Origin，来源不符直接拒绝 */
function secureRead(req, config) {
  if (!config.originConfigured) return;
  if (req.headers.origin && !validateOrigin(req.headers.origin, config)) throw new HttpError(403, "ORIGIN_DENIED", "请求来源不受信任");
}

export function createImportRoutes({ store, config, services = {} }) {
  const extract = services.extract || (async (periodId) => extractPeriod(periodId, {
    store,
    curation: await loadPeriodCuration(join(config.root, "data", "curation"), periodId),
  }));
  const publish = services.publish || ((value) => publishDraft({ ...value, root: config.root, storageRoot: config.storageRoot }));
  const previousSnapshot = services.previousSnapshot || ((periodId) => loadPublishedSnapshot(config.root, periodId));

  return async function route(req, res, url) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (req.method === "GET" && url.pathname === "/api/import/session") {
      const token = randomBytes(32).toString("hex");
      const secureFlag = config.allowedOrigin.startsWith("https://") ? "; Secure" : "";
      res.setHeader("set-cookie", `ai_cockpit_csrf=${token}; Path=/api/import/; SameSite=Strict${secureFlag}`);
      json(res, 200, { csrfToken: token });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/import/periods") {
      secure(req, config);
      const body = await readJsonBody(req);
      // 截至时间是快照 manifest 的必填字段：创建时就拦下，否则用户走完上传解析审核才在发布时失败
      if (!String(body.asOf ?? "").trim()) {
        throw new HttpError(422, "ASOF_REQUIRED", "请填写期次数据截至时间（asOf，含时区，例 2026-10-21T18:00:00+08:00）");
      }
      json(res, 201, await store.createPeriod(body));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/import/releases") {
      secureRead(req, config);
      json(res, 200, { releases: await listReleases(config.storageRoot) });
      return true;
    }
    if (req.method === "POST" && parts[0] === "api" && parts[1] === "import" && parts[2] === "releases" && parts[3] && parts[4] === "rollback") {
      secure(req, config);
      const { actor } = await readJsonBody(req);
      if (!actor) throw new HttpError(422, "ACTOR_REQUIRED", "请填写操作者显示名");
      json(res, 200, await rollbackRelease({ releaseId: parts[3], root: config.root, storageRoot: config.storageRoot, actor }));
      return true;
    }
    if (parts[0] === "api" && parts[1] === "import" && parts[2] === "periods" && parts[3]) {
      const periodId = parts[3];
      if (req.method === "GET" && parts.length === 4) {
        secureRead(req, config);
        const period = await store.getPeriod(periodId);
        if (!period) throw new HttpError(404, "PERIOD_NOT_FOUND", "期次草稿不存在");
        json(res, 200, { period, draft: await store.getDraft(periodId), quality: await store.getQuality(periodId) });
        return true;
      }
      if (req.method === "POST" && parts[4] === "files") {
        secure(req, config);
        // 上传是读—改—写：串行化后才能保证去重与期次配额判断有效
        json(res, 201, await store.transaction(periodId, () => receiveHtmlUpload(req, { periodId, store, config })));
        return true;
      }
      if (req.method === "POST" && parts[4] === "extract") {
        secure(req, config);
        json(res, 200, await store.transaction(periodId, () => extract(periodId)));
        return true;
      }
      if (req.method === "PATCH" && parts[4] === "draft") {
        secure(req, config);
        const patch = await readJsonBody(req);
        const actor = String(patch.actor || "").trim();
        if (!actor) throw new HttpError(422, "ACTOR_REQUIRED", "请填写审核人显示名");
        const next = await store.transaction(periodId, async () => {
          const current = (await store.getDraft(periodId)) || {};
          const merged = { ...current, ...patch.draft, revisions: [...(current.revisions || []), { at: new Date().toISOString(), actor, type: "manual_edit" }] };
          await store.saveDraft(periodId, merged);
          await store.saveQuality(periodId, merged.quality || { status: "ok", issues: [] });
          return merged;
        });
        json(res, 200, next);
        return true;
      }
      if (req.method === "POST" && parts[4] === "approve") {
        secure(req, config);
        const { actor } = await readJsonBody(req);
        if (!actor) throw new HttpError(422, "ACTOR_REQUIRED", "请填写审核人显示名");
        const period = await store.transaction(periodId, async () => {
          const current = await store.getPeriod(periodId);
          if (!current) throw new HttpError(404, "PERIOD_NOT_FOUND", "期次草稿不存在");
          if (!canApproveDraft(await store.getDraft(periodId))) throw new HttpError(409, "BLOCKING_ISSUES", "仍有未解决的阻断问题");
          const approved = { ...current, status: transitionImport(current.status, "approved") };
          await store.savePeriod(periodId, approved);
          return approved;
        });
        await store.appendAudit(periodId, { type: "draft_approved", actor });
        json(res, 200, period);
        return true;
      }
      if (req.method === "GET" && parts[4] === "diff") {
        secureRead(req, config);
        const current = await store.getDraft(periodId);
        if (!current) throw new HttpError(404, "DRAFT_NOT_FOUND", "期次草稿不存在");
        // 与该期次当前线上快照对比；尚未发布过时 previous 为 null，差异即全部新增
        json(res, 200, diffSnapshots(await previousSnapshot(periodId), snapshotFromDraft(current)));
        return true;
      }
      if (req.method === "POST" && parts[4] === "publish") {
        secure(req, config);
        const { actor } = await readJsonBody(req);
        if (!actor) throw new HttpError(422, "ACTOR_REQUIRED", "请填写发布人显示名");
        // 串行化 + 锁内重新读取状态，杜绝重复发布与并发绕过审核检查
        const release = await store.transaction(periodId, async () => {
          const current = await store.getPeriod(periodId);
          if (!current) throw new HttpError(404, "PERIOD_NOT_FOUND", "期次草稿不存在");
          if (current.status !== "approved") throw new HttpError(409, "NOT_APPROVED", "草稿尚未审核通过");
          const draft = await store.getDraft(periodId);
          await store.savePeriod(periodId, { ...current, status: transitionImport(current.status, "publishing") });
          try {
            const result = await publish({ periodId, draft, actor });
            await store.savePeriod(periodId, { ...current, status: transitionImport("publishing", "published") });
            return result;
          } catch (error) {
            // 发布失败退回已审核：草稿没变，可以直接重试，不会把期次锁死
            await store.savePeriod(periodId, { ...current, status: transitionImport("publishing", "approved") }).catch(() => {});
            throw error;
          }
        });
        await store.appendAudit(periodId, { type: "published", actor, releaseId: release.releaseId });
        json(res, 200, release);
        return true;
      }
    }
    return false;
  };
}
