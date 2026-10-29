import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateManifest } from "../../js/core/dashboard-schema.js";
import { SNAPSHOT_FILES, buildSnapshotFiles, validateSnapshotFiles } from "../../js/core/snapshot-contract.js";
import { canApproveDraft } from "./merge-draft.mjs";

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
    period: { start: period.id || null, end: period.end || null },
    departments: candidates.departments,
    demands: candidates.demands,
    capabilities: candidates.capabilities,
    capabilityRuns: curation.capabilityRuns,
    tokens: candidates.tokens,
    // 雷达只有审核通过的才进入正式快照，候选一律不放行
    radar: Array.isArray(radar) ? radar.filter((item) => item.reviewStatus === "approved") : radar,
    report: curation.report,
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
  if (!canApproveDraft(draft)) throw new Error("draft contains unresolved blocking issues");

  const releaseId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const generatedAt = new Date().toISOString();
  const snapshot = snapshotFromDraft(draft, { generatedAt, radarUpdatedAt: dateOnly(generatedAt) });

  // 发布前强制契约校验：宁可发布失败，也不让半份快照落盘
  const checked = validateSnapshotFiles(snapshot);
  if (!checked.ok) throw new Error(`snapshot invalid: ${checked.errors.join("; ")}`);

  const versionName = `${periodId}-${releaseId}`;
  const liveDir = resolve(root, "data", "snapshots", versionName);
  // 暂存目录放在 storageRoot 下，避免半成品进项目仓库
  const tempDir = resolve(storageRoot, ".publish-tmp", versionName);
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
    const manifest = { ...oldManifest, defaultPeriodId: periodId, periods: [period, ...oldManifest.periods.filter((item) => item.id !== periodId)] };
    const manifestChecked = validateManifest(manifest);
    if (!manifestChecked.ok) throw new Error(`manifest invalid: ${manifestChecked.errors.join("; ")}`);

    await mkdir(resolve(root, "data", "snapshots"), { recursive: true });
    await rename(tempDir, liveDir);

    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestTemp = resolve(root, "data", `manifest.${releaseId}.tmp`);
    await writeFile(manifestTemp, manifestText, "utf8");
    await rename(manifestTemp, resolve(root, "data", "manifest.json"));

    const releaseDir = resolve(storageRoot, "releases", releaseId);
    await mkdir(releaseDir, { recursive: true });
    await writeJson(join(releaseDir, "release.json"), { releaseId, periodId, actor, createdAt: generatedAt, manifest, manifestSha256: sha(manifestText) });

    return { releaseId, periodId, manifest };
  } finally {
    // 任何一步失败都清掉暂存目录，避免留下脏快照
    await rm(tempDir, { recursive: true, force: true });
  }
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
