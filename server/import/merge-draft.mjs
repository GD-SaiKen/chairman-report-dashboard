import { RADAR_DECISIONS, RADAR_TYPES, DEMAND_STATES, CAPABILITY_TYPES } from "../../js/core/dashboard-schema.js";
import { canPublishDigest } from "./digest.mjs";

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

/** 报告部门名 → 稳定 id；未映射一级部门时用它当下钻键 */
function departmentId(name) {
  const slug = String(name ?? "").toLowerCase()
    .replace(/[\s\u3000]+/g, "-")
    .replace(/[\\/"'<>#?%]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "department";
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
  const kpis = {};
  const unmapped = [];
  const sources = [...ruleResults, ...aiResults];

  for (const source of sources) {
    for (const item of source.kpiCandidates || []) {
      const value = toNumber(item.value);
      if (value == null || !item.key) continue;
      if (item.key in kpis) {
        if (kpis[item.key] !== value) addIssue(issues, { id: `kpi-conflict-${item.key}`, code: "KPI_CONFLICT", severity: "warning", message: `${item.key} 存在不同来源值，已采用首个`, resolved: false });
        continue;
      }
      kpis[item.key] = value;
    }

    for (const item of source.departmentCandidates || source.departments || []) {
      const name = String(item.name ?? "").trim();
      if (!name) continue;
      // 报告里的部门粒度常比驾驶舱的一级部门更细（车间 / 电脑室 / 财务部）。
      // 未映射时按原名落库并留一条提醒，不静默丢掉，也不擅自归并。
      const department = known.get(name) || { id: departmentId(name), name };
      // 多个未映射部门合并成一条提醒，避免首页「数据说明」被十几行同名警告淹没
      if (!known.has(name) && !unmapped.includes(name)) unmapped.push(name);
      const prior = byName.get(department.id);
      if (!prior) {
        const value = {
          ...department,
          activeUsers: toNumber(item.activeUsers),
          validDemands: toNumber(item.validDemands),
          activeSkills: null,
          activeAgents: null,
          outputs: null,
        };
        byName.set(department.id, value);
        departments.push(value);
      } else if (toNumber(item.activeUsers) != null && prior.activeUsers != null && prior.activeUsers !== toNumber(item.activeUsers)) {
        addIssue(issues, { id: `conflict-${department.id}`, code: "SOURCE_CONFLICT", severity: "blocking", message: `${department.name} 活跃人数存在不同来源值`, resolved: false });
      } else if (prior.activeUsers == null && toNumber(item.activeUsers) != null) {
        prior.activeUsers = toNumber(item.activeUsers);
      }
      if (prior && prior.validDemands == null && toNumber(item.validDemands) != null) prior.validDemands = toNumber(item.validDemands);
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
        // 周报给的是「业务调用 / 真失败」，失败数与成功率要原样带下去，
        // 否则能力专题只能显示「— 成功率」
        failures: toNumber(item.failures),
        successRate: toNumber(item.successRate),
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
        input: toNumber(item.input),
        output: toNumber(item.output),
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

  if (unmapped.length) {
    addIssue(issues, {
      id: "unmapped-departments",
      code: "UNMAPPED_DEPARTMENT",
      // info 级：按原名展示是可用状态，不该把整期标成「数据警告」
      severity: "info",
      message: `${unmapped.length} 个报告部门未映射一级部门，按原名展示：${unmapped.slice(0, 6).join("、")}${unmapped.length > 6 ? " 等" : ""}`,
      resolved: false,
    });
  }

  // 人工策展优先于抽取：策展缺失时才回落到抽取结果
  const fallback = (collected, curated) => (collected.length ? collected : curated ?? null);

  return {
    files,
    kpis,
    candidates: {
      departments: departments.length ? departments : curation.departments ?? null,
      demands: fallback(demands, curation.demands),
      capabilities: fallback(capabilities, curation.capabilities),
      tokens: fallback(tokens, curation.tokens),
      radar: fallback(radar, curation.radar),
    },
    // info 只是阅读提示，不影响「数据是否可正常使用」的判断
    quality: { status: issues.some((issue) => issue.severity !== "info") ? "warning" : "ok", issues },
    revisions: [],
    curation,
  };
}

export function canApproveDraft(draft) {
  const needsDigest = (draft.files || []).some((file) => file.reportType === "info-weekly" || file.publishOriginal);
  return (!needsDigest || canPublishDigest(draft.digest)) && !(draft.quality?.issues || []).some((issue) => issue.severity === "blocking" && !issue.resolved);
}
