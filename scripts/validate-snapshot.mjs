import { readFile } from "node:fs/promises";
import { validateManifest, validateCollection, validateDepartment, validateDemand, validateCapability, validateRadarItem } from "../js/core/dashboard-schema.js";

const periodId = process.argv[process.argv.indexOf("--period") + 1];
if (!periodId) throw new Error("用法：node scripts/validate-snapshot.mjs --period YYYY-MM-DD");
const manifest = JSON.parse(await readFile("data/manifest.json", "utf8"));
const period = manifest.periods.find((item) => item.id === periodId);
if (!period) throw new Error(`manifest 中没有期次 ${periodId}`);
const errors = [];
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const departments = await read(period.files.departments);
const demands = await read(period.files.demands);
const capabilities = await read(period.files.capabilities);
const radar = await read(period.files.radar);
errors.push(...validateCollection(departments.departments, validateDepartment, "departments").errors);
errors.push(...validateCollection(demands.demands, validateDemand, "demands").errors);
errors.push(...validateCollection(capabilities.capabilities, validateCapability, "capabilities").errors);
errors.push(...validateCollection(radar.items, validateRadarItem, "radar").errors);
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log(`snapshot valid: ${periodId}`);
