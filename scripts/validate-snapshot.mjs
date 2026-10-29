import { readFile } from "node:fs/promises";
import { SNAPSHOT_FILES, validateSnapshotFiles } from "../js/core/snapshot-contract.js";

const periodId = process.argv[process.argv.indexOf("--period") + 1];
if (!periodId) throw new Error("用法：node scripts/validate-snapshot.mjs --period YYYY-MM-DD");
const manifest = JSON.parse(await readFile("data/manifest.json", "utf8"));
const period = manifest.periods.find((item) => item.id === periodId);
if (!period) throw new Error(`manifest 中没有期次 ${periodId}`);

const files = {};
for (const name of SNAPSHOT_FILES) {
  files[name] = JSON.parse(await readFile(period.files[name], "utf8"));
}

const result = validateSnapshotFiles(files);
if (!result.ok) {
  console.error(result.errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`snapshot valid: ${periodId}`);
}
