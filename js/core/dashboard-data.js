import { validateManifest, validateCollection, validateDepartment, validateDemand, validateCapability, validateRadarItem, validateTokenRecord } from "./dashboard-schema.js";

export class DashboardDataError extends Error {}

async function readJson(url) {
  let response;
  try { response = await fetch(url, { cache: "no-cache" }); }
  catch { throw new DashboardDataError(`无法读取 ${url}，请通过 HTTP 静态服务打开页面。`); }
  if (!response.ok) throw new DashboardDataError(`读取 ${url} 失败（HTTP ${response.status}）。`);
  try { return await response.json(); }
  catch { throw new DashboardDataError(`${url} 不是合法 JSON。`); }
}

export async function loadManifest(url = "data/manifest.json") {
  const manifest = await readJson(url);
  const result = validateManifest(manifest);
  if (!result.ok) throw new DashboardDataError(`manifest 校验失败：${result.errors.join("；")}`);
  return manifest;
}

export function selectPeriod(manifest, requestedId) {
  return manifest.periods.find((period) => period.id === requestedId) || manifest.periods.find((period) => period.id === manifest.defaultPeriodId) || manifest.periods[0];
}

export async function loadSnapshot(manifest, periodId) {
  const period = selectPeriod(manifest, periodId);
  const entries = await Promise.all(Object.entries(period.files).map(async ([key, url]) => {
    try { return [key, await readJson(url)]; }
    catch (error) { return [key, { qualityStatus: "missing", error: error.message }]; }
  }));
  const snapshot = { period, ...Object.fromEntries(entries) };
  const errors = [];
  if (snapshot.departments?.departments) errors.push(...validateCollection(snapshot.departments.departments, validateDepartment, "departments").errors);
  if (snapshot.demands?.demands) errors.push(...validateCollection(snapshot.demands.demands, validateDemand, "demands").errors);
  if (snapshot.capabilities?.capabilities) errors.push(...validateCollection(snapshot.capabilities.capabilities, validateCapability, "capabilities").errors);
  if (snapshot.tokens?.records) errors.push(...validateCollection(snapshot.tokens.records, validateTokenRecord, "tokens.records").errors);
  if (snapshot.radar?.items) errors.push(...snapshot.radar.items.flatMap((item, index) => validateRadarItem(item).errors.map((error) => `radar[${index}]: ${error}`)));
  if (errors.length) snapshot.quality = { ...(snapshot.quality || {}), status: "warning", warnings: [...(snapshot.quality?.warnings || []), ...errors] };
  return snapshot;
}
