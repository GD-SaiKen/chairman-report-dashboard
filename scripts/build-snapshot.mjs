import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SNAPSHOT_FILES, buildSnapshotFiles, validateSnapshotFiles } from "../js/core/snapshot-contract.js";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const periodId = arg("--period");
const inputDir = resolve(arg("--input", `.local-data/${periodId}`));
if (!periodId) throw new Error("用法：node scripts/build-snapshot.mjs --period YYYY-MM-DD --input <dir>");

/** 缺失返回 null（而不是空数组），避免下游把「没有输入」当成「数量为零」 */
async function readOptional(name, fallback = null) {
  try {
    return JSON.parse(await readFile(join(inputDir, name), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

const source = {
  period: await readOptional("period.json", { start: periodId, end: periodId }),
  activities: await readOptional("activities.json"),
  demands: await readOptional("demands.json"),
  capabilities: await readOptional("capabilities.json"),
  tokens: await readOptional("tokens.json"),
  quality: await readOptional("quality.json", { status: "warning", warnings: ["部分输入文件缺失"] }),
};
const sourceRuns = await readOptional("capability-runs.json");
const curation = await readOptional("curation.json", {});
const rawDepartments = await readOptional("departments.json", curation.departments || []);
// 策展里的部门若只给了 id 字符串，不作为部门对象使用
const departments = Array.isArray(rawDepartments) ? rawDepartments.filter((item) => item && typeof item === "object") : [];

const generatedAt = new Date().toISOString();
const files = buildSnapshotFiles({
  period: source.period,
  activities: source.activities,
  departments: departments.length ? departments : null,
  demands: source.demands,
  capabilities: source.capabilities,
  capabilityRuns: sourceRuns,
  tokens: source.tokens,
  radar: curation.radar,
  report: curation.report,
  quality: {
    status: source.quality?.status ?? "missing",
    generatedAt,
    sources: source.quality?.sources,
    warnings: source.quality?.warnings,
  },
  radarUpdatedAt: generatedAt.slice(0, 10),
  validMessages: curation.validMessages,
  generatedAt,
});

const checked = validateSnapshotFiles(files);
if (!checked.ok) {
  console.error(checked.errors.join("\n"));
  process.exitCode = 1;
} else {
  const outDir = resolve(`data/snapshots/${periodId}`);
  await mkdir(outDir, { recursive: true });
  for (const name of SNAPSHOT_FILES) {
    await writeFile(join(outDir, `${name}.json`), `${JSON.stringify(files[name], null, 2)}\n`, "utf8");
  }
  console.log(`snapshot generated: ${outDir}`);
}
