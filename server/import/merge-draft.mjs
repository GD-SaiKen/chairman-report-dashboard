import { RADAR_DECISIONS, RADAR_TYPES, DEMAND_STATES, CAPABILITY_TYPES } from "../../js/core/dashboard-schema.js";

const AIKEY = /aikey/i;

function addIssue(issues, issue) {
  // 同一来源被多次遍历时不重复记录，避免工作台上出现成百上千条同 id 问题
  if (issues.some((item) => item.id === issue.id)) return;
  issues.push(issue);
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return text || null;
}

/** 候选名 → 枚举；AI 结果与规则结果写法不一致时在此收敛 */
function pickEnum(value, allowed) {
  const text = normalizeText(value);
  return text && allowed.includes(text) ? text : null;
}

/**
 * 把规则结果与 AI 结果合并为草稿。
 *
 * 关键约定：**未抽取到的类别输出 null 而不是 []**——空数组会让下游把
 * 「报告里没有对应表格」误判成「本期数量为 0」。契约层据此显示「—」。
 */
export function mergeDraft({ files = [], ruleResults = [], aiResults = [], curation = {}, departmentDictionary = [] }) {
  const issues = [];
  const departments = [];
  const demands = [];
  const capabilities = [];
  const tokens = [];
  const radar = [];
  const byName = new Map();
  const known = new Map(departmentDictionary.map((item) => [item.name, item]));
  const sources = [...ruleResults, ...aiResults];

  for (const source of sources) {
    for (const item of source.departmentCandidates || source.departments || []) {
      const department = known.get(item.name);
      if (!department) {
        addIssue(issues, { id: `unknown-${item.name}`, code: "UNKNOWN_DEPARTMENT", severity: "blocking", message: `未识别一级部门：${item.name}`, resolved: false });
        continue;
      }
      const prior = byName.get(department.id);
      if (prior && prior.activeUsers !== item.activeUsers) {
        addIssue(issues, { id: `conflict-${department.id}`, code: "SOURCE_CONFLICT", severity: "blocking", message: `${department.name} 活跃人数存在不同来源值`, resolved: false });
      } else if (!prior) {
        const value = { ...department, activeUsers: item.activeUsers };
        byName.set(department.id, value);
        departments.push(value);
      }
    }

    for (const item of source.demandCandidates || source.demands || []) {
      demands.push({
        id: item.id || null,
        date: item.date || null,
        departmentId: item.departmentId || null,
        requester: item.requester || null,
        title: item.title || null,
        theme: item.theme || null,
        subtheme: item.subtheme || null,
        frequency: toNumber(item.frequency),
        status: pickEnum(item.status, DEMAND_STATES),
        reusable: typeof item.reusable === "boolean" ? item.reusable : null,
        owner: item.owner || null,
        linkedCapabilityIds: Array.isArray(item.linkedCapabilityIds) ? item.linkedCapabilityIds : [],
        valueTags: Array.isArray(item.valueTags) ? item.valueTags : [],
      });
    }

    for (const item of source.capabilityCandidates || source.capabilities || []) {
      capabilities.push({
        id: item.id || null,
        name: item.name || null,
        type: pickEnum(item.type, CAPABILITY_TYPES),
        active: typeof item.active === "boolean" ? item.active : null,
        departmentIds: Array.isArray(item.departmentIds) ? item.departmentIds : [],
        runs: toNumber(item.runs),
        successes: toNumber(item.successes),
        outputs: toNumber(item.outputs),
        linkedDemandIds: Array.isArray(item.linkedDemandIds) ? item.linkedDemandIds : [],
        failureReason: item.failureReason || null,
      });
    }

    for (const item of source.tokenCandidates || source.tokens || []) {
      const sourceName = item.source || null;
      // 网关对账口径单独计量，不与业务量相加
      const reconciliationOnly = Boolean(item.reconciliationOnly) || AIKEY.test(sourceName || "");
      tokens.push({
        source: sourceName,
        input: null,
        output: null,
        effective: toNumber(item.effective),
        cacheRead: toNumber(item.cacheRead),
        classification: pickEnum(item.classification, ["business", "test", "system"]),
        reconciliationOnly,
        reconciliationTotal: toNumber(item.reconciliationTotal),
        departmentId: item.departmentId || null,
        date: item.date || null,
      });
    }

    for (const item of source.radarCandidates || source.radar || []) {
      radar.push({
        id: item.id || null,
        type: pickEnum(item.type, RADAR_TYPES),
        name: item.name || null,
        url: item.url || null,
        source: item.source || null,
        stars: toNumber(item.stars),
        starDelta7d: toNumber(item.starDelta7d),
        latestReleaseAt: item.latestReleaseAt || null,
        maturity: item.maturity || null,
        companyFit: item.companyFit || null,
        applicableDepartments: Array.isArray(item.applicableDepartments) ? item.applicableDepartments : [],
        risks: Array.isArray(item.risks) ? item.risks : [],
        decision: pickEnum(item.decision, RADAR_DECISIONS),
        reviewStatus: item.reviewStatus || "pending",
        summary: item.summary || null,
      });
    }
  }

  // 人工策展优先于抽取：策展缺失时才回落到抽取结果
  const fallback = (collected, curated) => (collected.length ? collected : curated ?? null);

  return {
    files,
    candidates: {
      departments: departments.length ? departments : curation.departments ?? null,
      demands: fallback(demands, curation.demands),
      capabilities: fallback(capabilities, curation.capabilities),
      tokens: fallback(tokens, curation.tokens),
      radar: fallback(radar, curation.radar),
    },
    quality: { status: issues.length ? "warning" : "ok", issues },
    revisions: [],
    curation,
  };
}

export function canApproveDraft(draft) {
  return !(draft.quality?.issues || []).some((issue) => issue.severity === "blocking" && !issue.resolved);
}
