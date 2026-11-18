import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateManifest } from "../../js/core/dashboard-schema.js";
import { SNAPSHOT_FILES, buildSnapshotFiles, validateSnapshotFiles } from "../../js/core/snapshot-contract.js";
import { canApproveDraft } from "./merge-draft.mjs";
import { sanitizeHtml } from "./sanitize.mjs";

const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const dateOnly = (iso) => String(iso).slice(0, 10);

/**
 * 草稿 → 快照文件集，结构与 scripts/build-snapshot.mjs 完全一致。
 * @param {Object} draft
 * @param {Object} [extra] {generatedAt, radarUpdatedAt} 便于测试保持输出确定性
 */
export function snapshotFromDraft(draft = {}, extra = {}) {
  const candidates = draft.candidates || {};
  const period = draft.period || {};
  const curation = draft.curation || {};
  const issues = draft.quality?.issues || [];
  const radar = candidates.radar;

  return buildSnapshotFiles({
    // 报告点名写出的期间口径（业务活跃用户 44 这类）优先于按明细累加
    kpiOverrides: draft.kpis || null,
    period: { start: period.id || null, end: period.end || null },
    departments: candidates.departments,
    demands: candidates.demands,
    capabilities: candidates.capabilities,
    capabilityRuns: curation.capabilityRuns,
    tokens: candidates.tokens,
    // 雷达只有审核通过的才进入正式快照，候选一律不放行
    radar: Array.isArray(radar) ? radar.filter((item) => item.reviewStatus === "approved") : radar,
    report: extra.report ?? curation.report,
    digest: draft.digest ? { headline: draft.digest.headline.text, highlights: draft.digest.highlights.map((item) => item.text), watchItems: draft.digest.watchItems.map((item) => item.text), reviewer: draft.digest.reviewer } : null,
    quality: {
      status: draft.quality?.status ?? "missing",
      generatedAt: extra.generatedAt ?? null,
      sources: curation.qualitySources || [],
      warnings: issues.filter((issue) => !issue.resolved).map((issue) => issue.message),
    },
    radarUpdatedAt: extra.radarUpdatedAt ?? null,
    validMessages: curation.validMessages,
    generatedAt: extra.generatedAt ?? null,
  });
}

export async function publishDraft({ periodId, draft, root, storageRoot, actor }) {
  if (!canApproveDraft(draft)) throw new Error("draft contains unresolved blocking issues or unreviewed digest");

  const releaseId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const generatedAt = new Date().toISOString();
  const primary = (draft.files || []).find((file) => file.reportType === "info-weekly") || (draft.files || []).find((file) => file.publishOriginal);
  let reportHtml = null;
  const reportPath = primary ? `reports/${periodId}-${releaseId}/index.html` : null;
  if (primary) {
    const source = await readFile(resolve(storageRoot, "uploads", periodId, "files", `${primary.fileId}.html`), "utf8");
    const cleaned = sanitizeHtml(source);
    assertStandaloneHtml(cleaned.document, cleaned.html);
    reportHtml = cleaned.html.replace(/<\/body>/i, '<a class="report-return" href="../../index.html">← 返回导读</a><style>.report-return{position:fixed;z-index:9999;left:16px;bottom:16px;padding:12px 18px;background:#2e5bc4;color:white!important;text-decoration:none;border-radius:4px;font:600 14px system-ui;box-shadow:0 4px 16px #17203333}@media print{.report-return{display:none}}</style></body>');
  }
  const snapshot = snapshotFromDraft(draft, { generatedAt, radarUpdatedAt: dateOnly(generatedAt), report: primary ? { title: primary.title, window: draft.period.window, localPath: reportPath, onlineUrl: null } : undefined });

  // 发布前强制契约校验：宁可发布失败，也不让半份快照落盘
  const checked = validateSnapshotFiles(snapshot);
  if (!checked.ok) throw new Error(`snapshot invalid: ${checked.errors.join("; ")}`);

  const versionName = `${periodId}-${releaseId}`;
  const liveDir = resolve(root, "data", "snapshots", versionName);
  // 暂存目录放在 storageRoot 下，避免半成品进项目仓库
  const tempDir = resolve(storageRoot, ".publish-tmp", versionName);
  const reportDir = reportPath ? resolve(root, "reports", `${periodId}-${releaseId}`) : null;
  const releaseDir = resolve(storageRoot, "releases", releaseId);
  const manifestTemp = resolve(root, "data", `manifest.${releaseId}.tmp`);
  let installedReport = false;
  let installedSnapshot = false;
  let installedRelease = false;
  let manifestCommitted = false;
  await mkdir(tempDir, { recursive: true });
  try {
    for (const name of SNAPSHOT_FILES) await writeJson(join(tempDir, `${name}.json`), snapshot[name]);

    const oldManifest = JSON.parse(await readFile(resolve(root, "data", "manifest.json"), "utf8"));
    const period = {
      id: periodId,
      label: draft.period.label,
      window: draft.period.window,
      asOf: draft.period.asOf,
      files: Object.fromEntries(SNAPSHOT_FILES.map((name) => [name, `data/snapshots/${versionName}/${name}.json`])),
    };
    // 期次按 id 倒序（新期在上）。回填或修订旧期时不能把默认期次改成旧期，
    // 否则用户打开首页会退回历史期次。
    const periods = [period, ...oldManifest.periods.filter((item) => item.id !== periodId)]
      .sort((a, b) => String(b.id).localeCompare(String(a.id)));
    const manifest = { ...oldManifest, defaultPeriodId: periods[0].id, periods };
    const manifestChecked = validateManifest(manifest);
    if (!manifestChecked.ok) throw new Error(`manifest invalid: ${manifestChecked.errors.join("; ")}`);

    if (reportDir) {
      await mkdir(reportDir, { recursive: true });
      await writeFile(join(reportDir, "index.html"), reportHtml, "utf8");
      installedReport = true;
    }
    await mkdir(resolve(root, "data", "snapshots"), { recursive: true });
    await rename(tempDir, liveDir);
    installedSnapshot = true;

    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestTemp, manifestText, "utf8");
    await mkdir(releaseDir, { recursive: true });
    installedRelease = true;
    await writeJson(join(releaseDir, "release.json"), { releaseId, periodId, actor, createdAt: generatedAt, manifest, manifestSha256: sha(manifestText) });
    await rename(manifestTemp, resolve(root, "data", "manifest.json"));
    manifestCommitted = true;

    return { releaseId, periodId, manifest };
  } catch (error) {
    if (!manifestCommitted) {
      if (installedReport) await rm(reportDir, { recursive: true, force: true });
      if (installedSnapshot) await rm(liveDir, { recursive: true, force: true });
      if (installedRelease) await rm(releaseDir, { recursive: true, force: true });
      await rm(manifestTemp, { force: true });
    }
    throw error;
  } finally {
    // 任何一步失败都清掉暂存目录，避免留下脏快照
    await rm(tempDir, { recursive: true, force: true });
  }
}

function assertStandaloneHtml(document, html) {
  const visit = (node) => {
    for (const attr of node.attrs || []) {
      if (!["href", "src", "poster"].includes(attr.name)) continue;
      const value = attr.value.trim();
      if (value && !/^(#|data:image\/|mailto:|tel:|https?:\/\/)/i.test(value)) throw new Error(`报告引用了未上传的本地资源：${value}`);
    }
    for (const child of node.childNodes || []) visit(child);
  };
  visit(document);
  if (/@import\b|url\(\s*['"]?(?!data:image\/)/i.test(html)) throw new Error("报告包含未上传的本地资源，请使用单文件 HTML");
}

export async function rollbackRelease({ releaseId, root, storageRoot, actor }) {
  const releasePath = resolve(storageRoot, "releases", releaseId, "release.json");
  let release;
  try {
    release = JSON.parse(await readFile(releasePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`release not found: ${releaseId}`);
    throw error;
  }
  if (!release?.manifest) throw new Error(`release has no manifest: ${releaseId}`);
  const text = `${JSON.stringify(release.manifest, null, 2)}\n`;
  const temp = resolve(root, "data", `manifest.rollback-${Date.now()}.tmp`);
  await writeFile(temp, text, "utf8");
  await rename(temp, resolve(root, "data", "manifest.json"));
  return { releaseId, actor, rolledBackAt: new Date().toISOString() };
}

/** 读取期次当前已发布的快照，用于发布前预览差异；读不到时返回 null */
export async function loadPublishedSnapshot(root, periodId) {
  let entry;
  try {
    const manifest = JSON.parse(await readFile(resolve(root, "data", "manifest.json"), "utf8"));
    entry = (manifest.periods || []).find((item) => item.id === periodId);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!entry) return null;
  const files = {};
  for (const name of SNAPSHOT_FILES) {
    try {
      files[name] = JSON.parse(await readFile(resolve(root, entry.files[name]), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  return files;
}

export async function listReleases(storageRoot) {
  let ids;
  try {
    ids = await readdir(resolve(storageRoot, "releases"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const results = [];
  for (const id of ids) {
    try {
      results.push(JSON.parse(await readFile(resolve(storageRoot, "releases", id, "release.json"), "utf8")));
    } catch (error) {
      // 目录里混有非 release 内容时跳过，而不是让整个列表 500
      if (error.code !== "ENOENT") throw error;
    }
  }
  return results;
}
