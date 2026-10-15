/**
 * core/catalog.js — 数据层
 *
 * 职责边界：只负责「取数 → 校验 → 归一化 → 派生指标」，
 * 不接触任何 DOM，因此可以单独跑单元测试，也可以整体换成后端接口。
 *
 * data/catalog.json 仍是唯一数据源，字段语义不变；
 * 归一化只是把「可能缺字段」的原始 JSON 补齐成视图层可以放心消费的形状。
 */

/** 数据来源元信息：标签 + 图标 + 语义色，新增来源只需在此登记 */
export const SOURCE_META = {
  info: { label: "信息部", icon: "server", tone: "info" },
  sino: { label: "双周报", icon: "activity", tone: "info" },
  deck: { label: "综合", icon: "layers", tone: "info" },
};

/** 待决策状态的语义映射：tone -> 徽标样式 */
const DECISION_TONE = { urgent: "danger", wait: "warn", watch: "info" };

export class CatalogError extends Error {}

export const sourceMeta = (key) =>
  SOURCE_META[key] || { label: key || "未标注", icon: "database", tone: "info" };

/** 兼容缺字段的原始数据 */
const toList = (value) => (Array.isArray(value) ? value : []);
const toText = (value, fallback = "—") =>
  value == null || value === "" ? fallback : String(value);

/**
 * 读取并归一化目录数据。
 * @param {string} url
 * @returns {Promise<{site: Object, periods: Object[], defaultId: string}>}
 */
export async function loadCatalog(url = "data/catalog.json") {
  let res;
  try {
    res = await fetch(url, { cache: "no-cache" });
  } catch {
    throw new CatalogError(
      "无法读取数据文件。请通过本地静态服务打开本页（浏览器会拦截 file:// 下的 fetch）。"
    );
  }

  if (!res.ok) {
    throw new CatalogError(`读取 ${url} 失败（HTTP ${res.status} ${res.statusText}）。`);
  }

  let raw;
  try {
    raw = await res.json();
  } catch {
    throw new CatalogError(`${url} 不是合法的 JSON。`);
  }

  return normalize(raw);
}

/** 把原始 JSON 归一化为视图层契约 */
export function normalize(raw) {
  const periods = toList(raw && raw.periods)
    .filter((p) => p && p.id)
    .map(normalizePeriod);

  if (!periods.length) {
    throw new CatalogError("data/catalog.json 中没有可用期次，请检查 periods 字段。");
  }

  const site = (raw && raw.site) || {};
  const wanted = raw && raw.defaultPeriodId;
  const defaultId = periods.some((p) => p.id === wanted) ? wanted : periods[0].id;

  return {
    site: {
      title: toText(site.title, "董事长驾驶舱"),
      subtitle: toText(site.subtitle, ""),
    },
    periods,
    defaultId,
  };
}

function normalizePeriod(p) {
  return {
    id: String(p.id),
    label: toText(p.label, String(p.id)),
    window: toText(p.window),
    updated: toText(p.updated),
    meters: toList(p.meters).map((m) => ({
      value: toText(m && m.value, "0"),
      unit: toText(m && m.unit, ""),
      label: toText(m && m.label, "未命名指标"),
      hint: toText(m && m.hint, ""),
      source: (m && m.source) || "",
    })),
    judgments: toList(p.judgments).map((j) => ({
      text: toText(j && j.text, ""),
      source: (j && j.source) || "",
    })),
    risks: toList(p.risks).map((r) => ({
      // 只有 red 与 amber 两级，其余一律降级为 amber，避免出现「未知颜色」
      level: r && r.level === "red" ? "red" : "amber",
      fact: toText(r && r.fact, ""),
      meaning: toText(r && r.meaning, ""),
    })),
    decisions: toList(p.decisions).map((d) => ({
      item: toText(d && d.item, ""),
      owner: toText(d && d.owner, ""),
      status: toText(d && d.status, "待处理"),
      tone: DECISION_TONE[(d && d.tone) || "watch"] || "info",
      // 排序权重：紧急 > 待办 > 观察
      weight: { urgent: 0, wait: 1, watch: 2 }[(d && d.tone) || "watch"] ?? 3,
    })),
    reports: toList(p.reports)
      .filter((r) => r && (r.localPath || r.onlineUrl))
      .map((r) => ({
        id: (r && r.id) || (r && r.title) || "report",
        title: toText(r && r.title, "未命名报告"),
        window: toText(r && r.window, ""),
        scope: toText(r && r.scope, ""),
        localPath: (r && r.localPath) || "",
        onlineUrl: (r && r.onlineUrl) || "",
      })),
  };
}

/**
 * 由期次数据派生首屏摘要（纯计算，不新增数据源）。
 * @param {Object} period
 */
export function summarize(period) {
  const red = period.risks.filter((r) => r.level === "red").length;
  const amber = period.risks.filter((r) => r.level === "amber").length;

  return {
    red,
    amber,
    decisions: period.decisions.length,
    reports: period.reports.length,
    meters: period.meters.length,
    // 结论数量用一个「需要董事长留意」的口径收口
    headline: `${red} 项红灯、${amber} 项黄灯，${period.decisions.length} 项待决策`,
  };
}

/** 待决策按紧急度排序（不改动原数组） */
export const sortDecisions = (decisions) =>
  [...decisions].sort((a, b) => a.weight - b.weight);
