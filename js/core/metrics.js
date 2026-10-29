import { DEMAND_STATES } from "./dashboard-schema.js";

const within = (date, period) => !period || (!period.start || date >= period.start) && (!period.end || date <= period.end);
const unique = (items) => [...new Set(items)];

export function summarizeAdoption(records = [], period) {
  const valid = records.filter((record) => record.actorType === "human" && record.classification === "business" && within(record.date, period));
  const byUser = new Map();
  for (const record of valid) {
    const item = byUser.get(record.userId) || { dates: new Set(), sessions: new Set(), departmentId: record.departmentId, firstSeen: record.firstSeen };
    item.dates.add(record.date);
    if (record.sessionId) item.sessions.add(record.sessionId);
    item.departmentId ||= record.departmentId;
    item.firstSeen ||= record.firstSeen;
    byUser.set(record.userId, item);
  }
  const users = [...byUser.values()];
  const repeatUsers = users.filter((user) => user.dates.size >= 2 || user.sessions.size >= 2).length;
  return {
    activeUsers: users.length,
    activeDepartments: unique(users.map((user) => user.departmentId).filter(Boolean)).length,
    newUsers: users.filter((user) => period?.start && user.firstSeen >= period.start && user.firstSeen <= period.end).length,
    repeatUsers,
    repeatRate: users.length ? repeatUsers / users.length : null,
  };
}

export function summarizeDepartments(records = [], demands = [], capabilities = [], tokens = [], period) {
  const adoption = summarizeAdoption(records, period);
  const departments = new Map();
  const ensure = (id, name = id) => {
    if (!id) return null;
    if (!departments.has(id)) departments.set(id, { id, name, activeUsers: 0, newUsers: 0, repeatUsers: 0, validDemands: 0, capabilities: 0, outputs: 0, tokens: { effective: 0, cacheRead: 0, nonBusiness: 0 } });
    return departments.get(id);
  };
  const usersByDepartment = new Map();
  records.filter((record) => record.actorType === "human" && record.classification === "business" && within(record.date, period)).forEach((record) => {
    const user = usersByDepartment.get(record.userId) || { departmentId: record.departmentId, dates: new Set(), sessions: new Set(), firstSeen: record.firstSeen };
    user.dates.add(record.date); if (record.sessionId) user.sessions.add(record.sessionId); user.firstSeen ||= record.firstSeen; usersByDepartment.set(record.userId, user);
  });
  for (const user of usersByDepartment.values()) {
    const department = ensure(user.departmentId);
    if (!department) continue;
    department.activeUsers += 1;
    if (period?.start && user.firstSeen >= period.start && user.firstSeen <= period.end) department.newUsers += 1;
    if (user.dates.size >= 2 || user.sessions.size >= 2) department.repeatUsers += 1;
  }
  for (const demand of demands.filter((demand) => within(demand.date, period))) ensure(demand.departmentId).validDemands += 1;
  for (const capability of capabilities) for (const departmentId of capability.departmentIds || []) ensure(departmentId).capabilities += 1;
  for (const token of tokens.filter((token) => within(token.date, period))) {
    const department = ensure(token.departmentId);
    if (!department) continue;
    const total = (token.input || 0) + (token.output || 0);
    if (token.classification === "business" && !token.reconciliationOnly) department.tokens.effective += total;
    else if (token.classification === "business" && token.reconciliationOnly) continue;
    else department.tokens.nonBusiness += total;
    department.tokens.cacheRead += token.cacheRead || 0;
  }
  return { ...adoption, departments: [...departments.values()].sort((a, b) => b.activeUsers - a.activeUsers || b.validDemands - a.validDemands) };
}

export function summarizeDemandFunnel(demands = []) {
  const counts = Object.fromEntries(DEMAND_STATES.map((state) => [state, 0]));
  for (const demand of demands) counts[demand.status] = (counts[demand.status] || 0) + 1;
  return { counts, total: demands.length, opportunities: demands.filter((demand) => demand.reusable).length };
}

export function summarizeCapabilities(capabilities = [], runs = []) {
  const result = { total: capabilities.length, active: 0, runs: 0, successes: 0, failures: 0, outputs: 0, byType: {} };
  for (const capability of capabilities) {
    result.byType[capability.type] = (result.byType[capability.type] || 0) + 1;
    if (capability.active) result.active += 1;
  }
  for (const run of runs) {
    result.runs += 1;
    if (run.status === "success") result.successes += 1;
    if (run.status === "failure") result.failures += 1;
    if (run.deliverableId || run.deliveryStatus === "sent") result.outputs += 1;
  }
  result.successRate = result.runs ? result.successes / result.runs : null;
  return result;
}

export function summarizeTokens(records = []) {
  const result = { input: 0, output: 0, cacheRead: 0, effective: 0, nonBusiness: 0, reconciliationOnly: 0, sourceBreakdown: {} };
  for (const record of records) {
    const total = (record.input || 0) + (record.output || 0);
    const source = result.sourceBreakdown[record.source] ||= { effective: 0, cacheRead: 0, nonBusiness: 0 };
    if (record.reconciliationOnly) {
      // 网关对账口径单独计量：有 reconciliationTotal 时用它，否则退回 input+output
      // 注意：Number(null) 为 0，必须先判空，否则未填 reconciliationTotal 时会被算成 0
      result.reconciliationOnly +=
        record.reconciliationTotal != null && Number.isFinite(Number(record.reconciliationTotal))
          ? Number(record.reconciliationTotal)
          : total;
      continue;
    }
    result.cacheRead += record.cacheRead || 0;
    source.cacheRead += record.cacheRead || 0;
    if (record.classification === "business") {
      result.input += record.input || 0; result.output += record.output || 0; result.effective += total; source.effective += total;
    } else {
      result.nonBusiness += total; source.nonBusiness += total;
    }
  }
  result.cacheRate = result.input + result.cacheRead ? result.cacheRead / (result.input + result.cacheRead) : null;
  return result;
}

export function buildOverview(snapshot) {
  return {
    adoption: summarizeAdoption(snapshot.activities, snapshot.period),
    demandFunnel: summarizeDemandFunnel(snapshot.demands),
    capabilities: summarizeCapabilities(snapshot.capabilities, snapshot.capabilityRuns),
    tokens: summarizeTokens(snapshot.tokens),
    quality: snapshot.quality || { status: "ok", warnings: [] },
  };
}
