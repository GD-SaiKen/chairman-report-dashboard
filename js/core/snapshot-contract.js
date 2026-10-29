/**
 * core/snapshot-contract.js — 两端共用的快照契约
 *
 * 存在原因：项目里曾有两条互不相容的快照生产者——
 *   · scripts/build-snapshot.mjs（走 metrics.js，产出完整结构）
 *   · server/import/publish.mjs（snapshotFromDraft，产出近乎空壳）
 * 二者对同一批专题产出不同键名，导致导入发布的期次在六个专题里大半为空。
 *
 * 本模块是唯一出口：无 DOM、无 I/O，只做「归一化输入 → 七个快照文件」，
 * 两端各自把输入归一化后交给它，因此结构必然一致。
 *
 * 核心约定：**缺失一律 null，绝不补 0**。
 * 没有证据的指标输出 null，UI 统一显示「—」；补 0 会让管理层把「没数据」
 * 误读成「真的是 0」。见 README「缺失数字保持 —，不得静默补零」。
 */

import { DEMAND_STATES, CAPABILITY_TYPES, RADAR_TYPES, RADAR_DECISIONS, QUALITY_STATES } from "./dashboard-schema.js";
import { summarizeAdoption, summarizeCapabilities, summarizeTokens } from "./metrics.js";

export const SNAPSHOT_FILES = ["overview", "departments", "demands", "capabilities", "tokens", "radar", "quality"];

/** 未知值：契约层唯一的缺失表示，禁止用 0 代替 */
const UNKNOWN = null;

const isList = (value) => Array.isArray(value);
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** 转数字；非有限数一律 null，绝不退回 0 */
function n(value) {
  if (value === UNKNOWN || value === "" || value === undefined) return UNKNOWN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : UNKNOWN;
}

/** 求和；若所有项都是未知，则结果也是未知（而不是 0） */
function sumOrNull(items, pick) {
  let total = 0;
  let seen = false;
  for (const item of items) {
    const value = n(pick(item));
    if (value === UNKNOWN) continue;
    total += value;
    seen = true;
  }
  return seen ? total : UNKNOWN;
}

function countType(capabilities, type) {
  return capabilities.filter((item) => item.type === type).length;
}

/** 统计活跃数；若该类型全部缺 active 标记，则结果未知（不能用 0 冒充实到） */
function countActiveCapabilities(capabilities) {
  if (!capabilities.length) return 0;
  if (capabilities.every((item) => item.active == null)) return UNKNOWN;
  return capabilities.filter((item) => item.active).length;
}

function countActiveAgents(capabilities) {
  const agents = capabilities.filter((item) => item.type === "agent");
  if (!agents.length) return 0;
  if (agents.every((item) => item.active == null)) return UNKNOWN;
  return agents.filter((item) => item.active).length;
}

function countActiveSkills(capabilities) {
  const skills = capabilities.filter((item) => item.type === "skill");
  if (!skills.length) return 0;
  if (skills.every((item) => item.active == null)) return UNKNOWN;
  return skills.filter((item) => item.active).length;
}

/**
 * 中文标题 → 合法 HTML id 片段（无空白，供 id 与 aria-labelledby 共用）。
 * HTML5 的 id 不得含 ASCII 空白，而 aria-labelledby 按空白切分成多个 IDREF，
 * 直接用中文标题当 id 会让读屏既找不到元素、又读不出区块标题。
 */
export function slugifyId(title, fallback = "section") {
  const raw = String(title ?? "").trim();
  if (!raw) return fallback;
  const slug = raw
    .replace(/[\s\u3000]+/g, "-")
    .replace(/["'`]/g, "")
    .replace(/[<>&]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return fallback;
  return /^\d/.test(slug) ? `s-${slug}` : slug;
}

/**
 * 归一化单条 Token 记录。
 * 只给了「有效消耗」而没给 input/output 时归并进 input——否则下游按 input+output
 * 汇总会把真实消耗算成 0。缺失（三项全无）则保持 null，绝不补 0。
 */
function normalizeToken(record) {
  const effective = n(record.effective);
  const input = n(record.input);
  const output = n(record.output);
  if (effective !== UNKNOWN && input === UNKNOWN && output === UNKNOWN) return { ...record, input: effective, output: 0 };
  return { ...record, input, output };
}

function normalizeInput(input = {}) {
  return {
    period: isObject(input.period) ? input.period : { start: UNKNOWN, end: UNKNOWN },
    activities: isList(input.activities) ? input.activities : UNKNOWN,
    departments: isList(input.departments) ? input.departments.filter(isObject) : UNKNOWN,
    demands: isList(input.demands) ? input.demands.filter(isObject) : UNKNOWN,
    capabilities: isList(input.capabilities) ? input.capabilities.filter(isObject) : UNKNOWN,
    capabilityRuns: isList(input.capabilityRuns) ? input.capabilityRuns.filter(isObject) : [],
    tokens: isList(input.tokens) ? input.tokens.filter(isObject).map(normalizeToken) : UNKNOWN,
    radar: isList(input.radar) ? input.radar.filter(isObject) : UNKNOWN,
    report: isObject(input.report) ? input.report : UNKNOWN,
    quality: isObject(input.quality) ? input.quality : UNKNOWN,
    radarUpdatedAt: input.radarUpdatedAt ?? UNKNOWN,
    validMessages: n(input.validMessages),
    generatedAt: input.generatedAt ?? UNKNOWN,
  };
}

/* ------------------------------ 各文件构建 ------------------------------ */

function buildKpis(input) {
  const { activities, departments, capabilities, demands } = input;
  // 有实名活动记录时走 metrics 的采用汇总；否则退回部门上报的活跃人数
  const adoption = activities ? summarizeAdoption(activities, input.period) : UNKNOWN;
  const fromDepartments = (field) => (departments ? sumOrNull(departments, (item) => item[field]) : UNKNOWN);

  const activeUsers = adoption ? adoption.activeUsers : fromDepartments("activeUsers");
  const repeatUsers = adoption ? adoption.repeatUsers : fromDepartments("repeatUsers");
  const newUsers = adoption ? adoption.newUsers : fromDepartments("newUsers");
  const activeDepartments = adoption
    ? adoption.activeDepartments
    : departments
      ? departments.filter((item) => (n(item.activeUsers) ?? 0) > 0).length || UNKNOWN
      : UNKNOWN;

  return {
    activeDepartments,
    activeUsers,
    newUsers,
    repeatUsers,
    repeatRate: adoption
      ? adoption.repeatRate
      : activeUsers && repeatUsers !== UNKNOWN
        ? repeatUsers / activeUsers
        : UNKNOWN,
    validDemands: demands ? demands.length : UNKNOWN,
    activeAgents: capabilities ? countActiveAgents(capabilities) : UNKNOWN,
    activeSkills: capabilities ? countActiveSkills(capabilities) : UNKNOWN,
  };
}

function buildDemandFunnel(demands) {
  if (!demands) return UNKNOWN;
  const counts = Object.fromEntries(DEMAND_STATES.map((state) => [state, 0]));
  for (const demand of demands) {
    if (demand.status in counts) counts[demand.status] += 1;
  }
  return { counts, total: demands.length, opportunities: demands.filter((demand) => demand.reusable).length };
}

function buildCapabilitySummary(capabilities, runs) {
  if (!capabilities) return UNKNOWN;
  const base = summarizeCapabilities(capabilities, runs);
  return {
    total: base.total,
    active: countActiveCapabilities(capabilities),
    skills: countType(capabilities, "skill"),
    agents: countType(capabilities, "agent"),
    automations: countType(capabilities, "automation"),
    runs: base.runs,
    successes: base.successes,
    failures: base.failures,
    outputs: base.outputs,
    successRate: base.successRate,
  };
}

/**
 * 未标注分类的 Token 默认按业务口径汇总。
 * 宁可归入口径存疑的业务量，也不能让数量在汇总里凭空消失；
 * 确属非业务的，应在输入里显式给出 classification。
 */
const asBusiness = (record) => (record.classification == null ? { ...record, classification: "business" } : record);

function buildTokenSummary(tokens) {
  if (!tokens) return UNKNOWN;
  const base = summarizeTokens(tokens.map(asBusiness));
  return {
    input: base.input,
    output: base.output,
    cacheRead: base.cacheRead,
    effective: base.effective,
    nonBusiness: base.nonBusiness,
    reconciliationOnly: base.reconciliationOnly,
    cacheRate: base.cacheRate,
  };
}

/** 按平台聚合，对账口径单独成行，不与业务量相加 */
function buildByPlatform(tokens) {
  if (!tokens) return [];
  const map = new Map();
  for (const record of tokens) {
    const name = record.source;
    if (!name) continue;
    const entry = map.get(name) || {
      name,
      effective: 0,
      cacheRead: 0,
      nonBusiness: 0,
      classification: record.classification ?? UNKNOWN,
      reconciliationOnly: Boolean(record.reconciliationOnly),
      reconciliationTotal: UNKNOWN,
    };
    const total = (n(record.input) ?? 0) + (n(record.output) ?? 0);
    if (record.reconciliationOnly) {
      const reconciled = n(record.reconciliationTotal) ?? total;
      entry.reconciliationTotal = (entry.reconciliationTotal ?? 0) + reconciled;
    } else if (record.classification == null || record.classification === "business") {
      entry.effective += total;
      entry.cacheRead += n(record.cacheRead) ?? 0;
    } else {
      entry.nonBusiness += total;
    }
    map.set(name, entry);
  }
  return [...map.values()];
}

/** 按部门聚合；网关对账不计入业务量 */
function buildByDepartment(tokens) {
  if (!tokens) return [];
  const map = new Map();
  for (const record of tokens) {
    const id = record.departmentId;
    if (!id || record.reconciliationOnly) continue;
    const entry = map.get(id) || { departmentId: id, effective: 0, cacheRead: 0, nonBusiness: 0 };
    const total = (n(record.input) ?? 0) + (n(record.output) ?? 0);
    if (record.classification == null || record.classification === "business") {
      entry.effective += total;
      entry.cacheRead += n(record.cacheRead) ?? 0;
    } else {
      entry.nonBusiness += total;
    }
    map.set(id, entry);
  }
  return [...map.values()];
}

function buildByDate(tokens) {
  if (!tokens) return [];
  const map = new Map();
  for (const record of tokens) {
    const date = record.date;
    if (!date || record.reconciliationOnly) continue;
    const entry = map.get(date) || { date, effective: 0 };
    entry.effective += (n(record.input) ?? 0) + (n(record.output) ?? 0);
    map.set(date, entry);
  }
  return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function buildDepartments(departments) {
  if (!departments) return [];
  return departments.map((item) => ({
    id: item.id ?? UNKNOWN,
    name: item.name ?? item.id ?? UNKNOWN,
    teams: isList(item.teams) ? item.teams : [],
    activeUsers: n(item.activeUsers),
    newUsers: n(item.newUsers),
    repeatUsers: n(item.repeatUsers),
    validDemands: n(item.validDemands),
    tokens: isObject(item.tokens)
      ? {
          effective: n(item.tokens.effective),
          cacheRead: n(item.tokens.cacheRead),
          nonBusiness: n(item.tokens.nonBusiness),
        }
      : { effective: UNKNOWN, cacheRead: UNKNOWN, nonBusiness: UNKNOWN },
    activeSkills: n(item.activeSkills),
    activeAgents: n(item.activeAgents),
    outputs: n(item.outputs),
    topThemes: isList(item.topThemes) ? item.topThemes : [],
    trend: isList(item.trend) ? item.trend : UNKNOWN,
  }));
}

function buildDemands(demands) {
  if (!demands) return [];
  return demands.map((item) => ({
    id: item.id ?? slugifyId(item.title, "demand"),
    date: item.date ?? UNKNOWN,
    departmentId: item.departmentId ?? UNKNOWN,
    requester: item.requester ?? UNKNOWN,
    title: item.title ?? UNKNOWN,
    theme: item.theme ?? UNKNOWN,
    subtheme: item.subtheme ?? UNKNOWN,
    frequency: n(item.frequency),
    status: DEMAND_STATES.includes(item.status) ? item.status : UNKNOWN,
    reusable: typeof item.reusable === "boolean" ? item.reusable : UNKNOWN,
    owner: item.owner ?? UNKNOWN,
    linkedCapabilityIds: isList(item.linkedCapabilityIds) ? item.linkedCapabilityIds : [],
    deliverableId: item.deliverableId ?? UNKNOWN,
    valueTags: isList(item.valueTags) ? item.valueTags : [],
  }));
}

function buildDemandSummary(demands, input) {
  if (!demands) return UNKNOWN;
  const themes = new Set(demands.map((item) => item.theme).filter(Boolean));
  return {
    total: demands.length,
    // 原始消息数（去重前）无法从需求条目推导，缺失时留空
    validMessages: input.validMessages,
    themes: themes.size || UNKNOWN,
  };
}

function buildCapabilities(capabilities) {
  if (!capabilities) return [];
  return capabilities.map((item) => ({
    id: item.id ?? slugifyId(item.name, "capability"),
    name: item.name ?? UNKNOWN,
    type: CAPABILITY_TYPES.includes(item.type) ? item.type : UNKNOWN,
    active: typeof item.active === "boolean" ? item.active : UNKNOWN,
    departmentIds: isList(item.departmentIds) ? item.departmentIds : [],
    runs: n(item.runs),
    successes: n(item.successes),
    outputs: n(item.outputs),
    linkedDemandIds: isList(item.linkedDemandIds) ? item.linkedDemandIds : [],
    failureReason: item.failureReason ?? UNKNOWN,
  }));
}

function buildCapabilityRuns(runs) {
  return runs.map((item) => ({
    capabilityId: item.capabilityId ?? UNKNOWN,
    date: item.date ?? UNKNOWN,
    status: item.status ?? UNKNOWN,
    deliverableId: item.deliverableId ?? UNKNOWN,
    deliveryStatus: item.deliveryStatus ?? UNKNOWN,
  }));
}

function buildRadarItems(radar) {
  if (!radar) return [];
  return radar.map((item) => ({
    id: item.id ?? slugifyId(item.name, "radar"),
    type: RADAR_TYPES.includes(item.type) ? item.type : UNKNOWN,
    name: item.name ?? UNKNOWN,
    url: item.url ?? UNKNOWN,
    source: item.source ?? UNKNOWN,
    stars: n(item.stars),
    starDelta7d: n(item.starDelta7d),
    latestReleaseAt: item.latestReleaseAt ?? UNKNOWN,
    maturity: item.maturity ?? UNKNOWN,
    companyFit: item.companyFit ?? UNKNOWN,
    applicableDepartments: isList(item.applicableDepartments) ? item.applicableDepartments : [],
    risks: isList(item.risks) ? item.risks : [],
    decision: RADAR_DECISIONS.includes(item.decision) ? item.decision : UNKNOWN,
    reviewStatus: item.reviewStatus ?? UNKNOWN,
    summary: item.summary ?? UNKNOWN,
  }));
}

function buildReport(report) {
  if (!report) return UNKNOWN;
  return {
    title: report.title ?? UNKNOWN,
    window: report.window ?? UNKNOWN,
    localPath: report.localPath ?? UNKNOWN,
    onlineUrl: report.onlineUrl ?? UNKNOWN,
  };
}

function buildQuality(quality, input) {
  const warnings = isList(quality?.warnings) ? quality.warnings : [];
  return {
    status: QUALITY_STATES.includes(quality?.status) ? quality.status : "missing",
    generatedAt: quality?.generatedAt ?? input.generatedAt,
    sources: isList(quality?.sources) ? quality.sources : [],
    warnings,
  };
}

/* ------------------------------ 对外接口 ------------------------------ */

/**
 * 归一化输入 → 七个快照文件。
 *
 * @param {Object} input
 * @param {{start?:string,end?:string}} [input.period]
 * @param {Array} [input.activities]     实名活动记录，用于采用汇总
 * @param {Array} [input.departments]    一级部门；缺失传 undefined/null，不要传空数组冒充已知
 * @param {Array} [input.demands]        需求条目
 * @param {Array} [input.capabilities]   能力资产
 * @param {Array} [input.capabilityRuns] 能力运行记录
 * @param {Array} [input.tokens]         Token 记录（可带 source/date/departmentId/reconciliationOnly/reconciliationTotal）
 * @param {Array} [input.radar]          雷达条目（发布时只应传 reviewStatus==='approved' 的）
 * @param {Object} [input.report]        {title,window,localPath,onlineUrl}
 * @param {Object} [input.quality]       {status,generatedAt,sources,warnings}
 * @returns {Record<string, Object>} 键与 SNAPSHOT_FILES 一致
 */
export function buildSnapshotFiles(rawInput = {}) {
  const input = normalizeInput(rawInput);
  const quality = buildQuality(input.quality, input);
  const demands = buildDemands(input.demands);
  const capabilities = buildCapabilities(input.capabilities);
  const tokenSummary = buildTokenSummary(input.tokens);

  return {
    overview: {
      period: { start: input.period.start ?? UNKNOWN, end: input.period.end ?? UNKNOWN },
      kpis: buildKpis(input),
      demandFunnel: buildDemandFunnel(input.demands),
      capabilities: buildCapabilitySummary(input.capabilities, input.capabilityRuns),
      tokens: tokenSummary,
      report: buildReport(input.report),
      quality,
    },
    departments: { departments: buildDepartments(input.departments) },
    demands: { summary: buildDemandSummary(input.demands, input), demands },
    capabilities: {
      summary: buildCapabilitySummary(input.capabilities, input.capabilityRuns),
      capabilities,
      runs: buildCapabilityRuns(input.capabilityRuns),
    },
    tokens: {
      summary: tokenSummary,
      byDepartment: buildByDepartment(input.tokens),
      byPlatform: buildByPlatform(input.tokens),
      byDate: buildByDate(input.tokens),
    },
    radar: { updated: input.radarUpdatedAt, items: buildRadarItems(input.radar) },
    quality,
  };
}

/* ------------------------------ 契约校验 ------------------------------ */

function checkNumber(value, path, errors) {
  if (value === UNKNOWN || value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${path} must be a finite number or null`);
}

const KPI_KEYS = ["activeDepartments", "activeUsers", "newUsers", "repeatUsers", "repeatRate", "validDemands", "activeAgents", "activeSkills"];
const TOKEN_KEYS = ["input", "output", "cacheRead", "effective", "nonBusiness", "reconciliationOnly", "cacheRate"];
const CAPABILITY_SUMMARY_KEYS = ["total", "active", "skills", "agents", "automations", "runs", "successes", "failures", "outputs", "successRate"];

function validateOverview(overview, errors) {
  if (!isObject(overview)) { errors.push("overview must be an object"); return; }
  for (const key of ["period", "kpis", "demandFunnel", "capabilities", "tokens", "quality"]) {
    if (!(key in overview)) errors.push(`overview.${key} is required`);
  }
  const kpis = overview.kpis;
  if (!isObject(kpis)) { errors.push("overview.kpis must be an object"); return; }
  for (const key of KPI_KEYS) {
    if (!(key in kpis)) errors.push(`overview.kpis.${key} is required`);
    else checkNumber(kpis[key], `overview.kpis.${key}`, errors);
  }
  const tokens = overview.tokens;
  if (isObject(tokens)) {
    for (const key of TOKEN_KEYS) {
      if (!(key in tokens)) errors.push(`overview.tokens.${key} is required`);
      else checkNumber(tokens[key], `overview.tokens.${key}`, errors);
    }
  } else if (tokens !== UNKNOWN) {
    errors.push("overview.tokens must be an object or null");
  }
  const capabilitySummary = overview.capabilities;
  if (isObject(capabilitySummary)) {
    for (const key of CAPABILITY_SUMMARY_KEYS) {
      if (!(key in capabilitySummary)) errors.push(`overview.capabilities.${key} is required`);
      else checkNumber(capabilitySummary[key], `overview.capabilities.${key}`, errors);
    }
  } else if (capabilitySummary !== UNKNOWN) {
    errors.push("overview.capabilities must be an object or null");
  }
  const funnel = overview.demandFunnel;
  if (isObject(funnel)) {
    if (!isObject(funnel.counts)) errors.push("overview.demandFunnel.counts must be an object");
    else for (const state of DEMAND_STATES) if (!(state in funnel.counts)) errors.push(`overview.demandFunnel.counts.${state} is required`);
    checkNumber(funnel.total, "overview.demandFunnel.total", errors);
    checkNumber(funnel.opportunities, "overview.demandFunnel.opportunities", errors);
  } else if (funnel !== UNKNOWN) {
    errors.push("overview.demandFunnel must be an object or null");
  }
}

function validateItems(items, name, requiredKeys, errors) {
  if (!Array.isArray(items)) { errors.push(`${name} must be an array`); return; }
  items.forEach((item, index) => {
    if (!isObject(item)) { errors.push(`${name}[${index}] must be an object`); return; }
    for (const key of requiredKeys) {
      if (item[key] === undefined) errors.push(`${name}[${index}].${key} must be present (use null when unknown)`);
    }
  });
}

function validateDepartments(departments, errors) {
  validateItems(departments, "departments.departments", ["id", "name", "activeUsers", "newUsers", "repeatUsers", "validDemands", "activeSkills", "activeAgents", "outputs"], errors);
}

function validateDemands(demands, errors) {
  if (!isObject(demands)) { errors.push("demands must be an object"); return; }
  if (demands.summary !== UNKNOWN && !isObject(demands.summary)) errors.push("demands.summary must be an object or null");
  validateItems(demands.demands, "demands.demands", ["id", "title", "departmentId", "status", "theme", "frequency"], errors);
}

function validateCapabilities(capabilities, errors) {
  if (!isObject(capabilities)) { errors.push("capabilities must be an object"); return; }
  if (capabilities.summary !== UNKNOWN && !isObject(capabilities.summary)) errors.push("capabilities.summary must be an object or null");
  validateItems(capabilities.capabilities, "capabilities.capabilities", ["id", "name", "type", "active", "runs"], errors);
  if (!Array.isArray(capabilities.runs)) errors.push("capabilities.runs must be an array");
}

function validateTokens(tokens, errors) {
  if (!isObject(tokens)) { errors.push("tokens must be an object"); return; }
  for (const key of ["summary", "byDepartment", "byPlatform", "byDate"]) {
    if (!(key in tokens)) errors.push(`tokens.${key} is required`);
  }
  if (isObject(tokens.summary)) {
    for (const key of TOKEN_KEYS) {
      if (!(key in tokens.summary)) errors.push(`tokens.summary.${key} is required`);
      else checkNumber(tokens.summary[key], `tokens.summary.${key}`, errors);
    }
  } else if (tokens.summary !== UNKNOWN) {
    errors.push("tokens.summary must be an object or null");
  }
  // 这三个明细表契约层永远产出数组（可能为空），null 只可能来自手工拼装的数据
  for (const key of ["byDepartment", "byPlatform", "byDate"]) {
    if (!Array.isArray(tokens[key])) errors.push(`tokens.${key} must be an array`);
  }
}

function validateRadar(radar, errors) {
  if (!isObject(radar)) { errors.push("radar must be an object"); return; }
  if (!Array.isArray(radar.items)) { errors.push("radar.items must be an array"); return; }
  radar.items.forEach((item, index) => {
    if (!isObject(item)) { errors.push(`radar.items[${index}] must be an object`); return; }
    for (const key of ["id", "type", "name", "decision", "reviewStatus"]) {
      if (item[key] === undefined) errors.push(`radar.items[${index}].${key} must be present (use null when unknown)`);
    }
    if (item.reviewStatus != null && item.reviewStatus !== "approved") {
      errors.push(`radar.items[${index}].reviewStatus must be approved for publication`);
    }
  });
}

function validateQuality(quality, errors) {
  if (!isObject(quality)) { errors.push("quality must be an object"); return; }
  if (!QUALITY_STATES.includes(quality.status)) errors.push(`quality.status must be one of ${QUALITY_STATES.join(", ")}`);
  if (!Array.isArray(quality.warnings)) errors.push("quality.warnings must be an array");
}

/**
 * 校验七个快照文件是否符合契约。
 * 重点拦截三类真实缺陷：缺键、把缺失补成 0、以及 undefined/NaN 泄漏到数据里。
 *
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateSnapshotFiles(files) {
  const errors = [];
  if (!isObject(files)) return { ok: false, errors: ["snapshot must be an object"] };
  for (const name of SNAPSHOT_FILES) {
    // 键缺失与显式 null/undefined 都算「没有这个文件」
    if (files[name] == null) errors.push(`${name} is required`);
  }
  // 文件本身缺失时不再重复报内部结构问题，避免同一处故障刷出多条错误
  if (files.overview != null) validateOverview(files.overview, errors);
  if (files.departments != null) validateDepartments(files.departments.departments, errors);
  if (files.demands != null) validateDemands(files.demands, errors);
  if (files.capabilities != null) validateCapabilities(files.capabilities, errors);
  if (files.tokens != null) validateTokens(files.tokens, errors);
  if (files.radar != null) validateRadar(files.radar, errors);
  if (files.quality != null) validateQuality(files.quality, errors);
  return { ok: errors.length === 0, errors };
}
