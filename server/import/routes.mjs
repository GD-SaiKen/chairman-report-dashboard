import { randomBytes } from "node:crypto";
import { HttpError, json, readJsonBody } from "./http.mjs";
import { parseCookies, validateCsrf, validateOrigin } from "./security.mjs";
import { receiveHtmlUpload } from "./upload.mjs";
import { extractPeriod } from "./pipeline.mjs";
import { canApproveDraft } from "./merge-draft.mjs";
import { transitionImport } from "./state-machine.mjs";
import { diffSnapshots } from "./diff.mjs";
import { listReleases, publishDraft, rollbackRelease, snapshotFromDraft } from "./publish.mjs";

function secure(req, config) {
  if (!validateOrigin(req.headers.origin, config)) throw new HttpError(403, "ORIGIN_DENIED", "请求来源不受信任");
  const cookies = parseCookies(req.headers.cookie);
  if (!validateCsrf({ cookieToken: cookies.ai_cockpit_csrf, headerToken: req.headers["x-csrf-token"] })) throw new HttpError(403, "CSRF_DENIED", "请求校验失败");
}

export function createImportRoutes({ store, config, services = {} }) {
  const extract = services.extract || ((periodId) => extractPeriod(periodId, { store }));
  const publish = services.publish || ((value) => publishDraft({ ...value, root: config.root, storageRoot: config.storageRoot }));
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
      json(res, 201, await store.createPeriod(await readJsonBody(req)));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/import/releases") {
      json(res, 200, { releases: await listReleases(config.storageRoot) });
      return true;
    }
    if (req.method === "POST" && parts[0] === "api" && parts[1] === "import" && parts[2] === "releases" && parts[3] && parts[4] === "rollback") {
      secure(req, config); const { actor } = await readJsonBody(req);
      if (!actor) throw new HttpError(422, "ACTOR_REQUIRED", "请填写操作者显示名");
      json(res, 200, await rollbackRelease({ releaseId: parts[3], root: config.root, storageRoot: config.storageRoot, actor })); return true;
    }
    if (parts[0] === "api" && parts[1] === "import" && parts[2] === "periods" && parts[3]) {
      const periodId = parts[3];
      if (req.method === "GET" && parts.length === 4) {
        const period = await store.getPeriod(periodId);
        if (!period) throw new HttpError(404, "PERIOD_NOT_FOUND", "期次草稿不存在");
        json(res, 200, { period, draft: await store.getDraft(periodId), quality: await store.getQuality(periodId) });
        return true;
      }
      if (req.method === "POST" && parts[4] === "files") {
        secure(req, config);
        json(res, 201, await receiveHtmlUpload(req, { periodId, store, config }));
        return true;
      }
      if (req.method === "POST" && parts[4] === "extract") {
        secure(req, config);
        json(res, 200, await extract(periodId));
        return true;
      }
      if (req.method === "PATCH" && parts[4] === "draft") {
        secure(req, config);
        const current = await store.getDraft(periodId);
        const patch = await readJsonBody(req);
        const actor = String(patch.actor || "").trim();
        if (!actor) throw new HttpError(422, "ACTOR_REQUIRED", "请填写审核人显示名");
        const next = { ...current, ...patch.draft, revisions: [...(current.revisions || []), { at: new Date().toISOString(), actor, type: "manual_edit" }] };
        await store.saveDraft(periodId, next);
        await store.saveQuality(periodId, next.quality || { status: "ok", issues: [] });
        json(res, 200, next);
        return true;
      }
      if (req.method === "POST" && parts[4] === "approve") {
        secure(req, config);
        const { actor } = await readJsonBody(req);
        const draft = await store.getDraft(periodId);
        if (!actor) throw new HttpError(422, "ACTOR_REQUIRED", "请填写审核人显示名");
        if (!canApproveDraft(draft)) throw new HttpError(409, "BLOCKING_ISSUES", "仍有未解决的阻断问题");
        const period = await store.getPeriod(periodId);
        period.status = transitionImport(period.status, "approved");
        await store.savePeriod(periodId, period);
        await store.appendAudit(periodId, { type: "draft_approved", actor });
        json(res, 200, period);
        return true;
      }
      if (req.method === "GET" && parts[4] === "diff") {
        const draft = await store.getDraft(periodId);
        json(res, 200, diffSnapshots({}, snapshotFromDraft(draft)));
        return true;
      }
      if (req.method === "POST" && parts[4] === "publish") {
        secure(req, config); const { actor } = await readJsonBody(req);
        if (!actor) throw new HttpError(422, "ACTOR_REQUIRED", "请填写发布人显示名");
        const period = await store.getPeriod(periodId); const draft = await store.getDraft(periodId);
        if (period.status !== "approved") throw new HttpError(409, "NOT_APPROVED", "草稿尚未审核通过");
        period.status = transitionImport(period.status, "publishing"); await store.savePeriod(periodId, period);
        const result = await publish({ periodId, draft, actor });
        period.status = transitionImport("publishing", "published"); await store.savePeriod(periodId, period);
        await store.appendAudit(periodId, { type: "published", actor, releaseId: result.releaseId });
        json(res, 200, result); return true;
      }
    }
    return false;
  };
}
