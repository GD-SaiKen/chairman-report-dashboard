import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildOverview } from "../js/core/metrics.js";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const periodId = arg("--period");
const inputDir = resolve(arg("--input", `.local-data/${periodId}`));
if (!periodId) throw new Error("用法：node scripts/build-snapshot.mjs --period YYYY-MM-DD --input <dir>");

const readOptional = async (name, fallback) => {
  try { return JSON.parse(await readFile(join(inputDir, name), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
};

const source = {
  period: await readOptional("period.json", { start: periodId, end: periodId }),
  activities: await readOptional("activities.json", []),
  demands: await readOptional("demands.json", []),
  capabilities: await readOptional("capabilities.json", []),
  capabilityRuns: await readOptional("capability-runs.json", []),
  tokens: await readOptional("tokens.json", []),
  quality: await readOptional("quality.json", { status: "warning", warnings: ["部分输入文件缺失"] }),
};
const curation = await readOptional("curation.json", {});
const outDir = resolve(`data/snapshots/${periodId}`);
await mkdir(outDir, { recursive: true });
const overview = { ...buildOverview(source), ...(curation.overview || {}), period: source.period };
const departments = curation.departments || [];
const capabilities = { summary: overview.capabilities, capabilities: source.capabilities, runs: source.capabilityRuns };
const tokens = { summary: overview.tokens, byDepartment: curation.tokensByDepartment || [], byPlatform: curation.tokensByPlatform || [], byDate: curation.tokensByDate || [] };
const radar = { updated: new Date().toISOString().slice(0, 10), items: (curation.radar || []).filter((item) => item.reviewStatus === "approved") };
const files = { "overview.json": overview, "departments.json": { departments }, "demands.json": { summary: curation.demandSummary || { total: source.demands.length }, demands: source.demands }, "capabilities.json": capabilities, "tokens.json": tokens, "radar.json": radar, "quality.json": source.quality };
for (const [name, value] of Object.entries(files)) await writeFile(join(outDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
console.log(`snapshot generated: ${outDir}`);
