import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateManifest } from "../../js/core/dashboard-schema.js";
import { canApproveDraft } from "./merge-draft.mjs";

const names = ["overview", "departments", "demands", "capabilities", "tokens", "radar", "quality"];
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const sha = (value) => createHash("sha256").update(value).digest("hex");

export function snapshotFromDraft(draft) {
  const c = draft.candidates || {};
  return {
    overview: { period: draft.period, kpis: draft.summary?.kpis || {}, tokens: draft.summary?.tokens || {}, quality: draft.quality },
    departments: { departments: c.departments || [] }, demands: { demands: c.demands || [] },
    capabilities: { capabilities: c.capabilities || [], summary: draft.summary?.capabilities || {} },
    tokens: { summary: draft.summary?.tokens || {}, records: c.tokens || [] },
    radar: { items: (c.radar || []).filter((item) => item.reviewStatus === "approved") }, quality: draft.quality || { status: "ok", issues: [] },
  };
}

export async function publishDraft({ periodId, draft, root, storageRoot, actor }) {
  if (!canApproveDraft(draft)) throw new Error("draft contains unresolved blocking issues");
  const releaseId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const snapshot = snapshotFromDraft(draft);
  const versionName = `${periodId}-${releaseId}`;
  const tempDir = resolve(root, ".publish-tmp", versionName);
  const liveDir = resolve(root, "data", "snapshots", versionName);
  await mkdir(tempDir, { recursive: true });
  for (const name of names) await writeJson(join(tempDir, `${name}.json`), snapshot[name]);
  const oldManifest = JSON.parse(await readFile(resolve(root, "data", "manifest.json"), "utf8"));
  const period = { id: periodId, label: draft.period.label, window: draft.period.window, asOf: draft.period.asOf, files: Object.fromEntries(names.map((name) => [name, `data/snapshots/${versionName}/${name}.json`])) };
  const manifest = { ...oldManifest, defaultPeriodId: periodId, periods: [period, ...oldManifest.periods.filter((item) => item.id !== periodId)] };
  const checked = validateManifest(manifest); if (!checked.ok) throw new Error(`manifest invalid: ${checked.errors.join("; ")}`);
  await mkdir(resolve(root, "data", "snapshots"), { recursive: true });
  await rename(tempDir, liveDir);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestTemp = resolve(root, "data", `manifest.${releaseId}.tmp`);
  await writeFile(manifestTemp, manifestText, "utf8");
  await rename(manifestTemp, resolve(root, "data", "manifest.json"));
  const releaseDir = resolve(storageRoot, "releases", releaseId); await mkdir(releaseDir, { recursive: true });
  await writeJson(join(releaseDir, "release.json"), { releaseId, periodId, actor, createdAt: new Date().toISOString(), manifest, manifestSha256: sha(manifestText) });
  return { releaseId, periodId, manifest };
}

export async function rollbackRelease({ releaseId, root, storageRoot, actor }) {
  const release = JSON.parse(await readFile(resolve(storageRoot, "releases", releaseId, "release.json"), "utf8"));
  const text = `${JSON.stringify(release.manifest, null, 2)}\n`;
  const temp = resolve(root, "data", `manifest.rollback-${Date.now()}.tmp`);
  await writeFile(temp, text, "utf8");
  await rename(temp, resolve(root, "data", "manifest.json"));
  return { releaseId, actor, rolledBackAt: new Date().toISOString() };
}

export async function listReleases(storageRoot) {
  try {
    const ids = await readdir(resolve(storageRoot, "releases"));
    return Promise.all(ids.map(async (id) => JSON.parse(await readFile(resolve(storageRoot, "releases", id, "release.json"), "utf8"))));
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
