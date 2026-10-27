import { section, panel, fmt, table, h } from "./shared.js";

export function renderDemands(snapshot) {
  const summary = snapshot.demands?.summary || {};
  const demands = snapshot.demands?.demands || [];
  const rows = demands.map((item) => [item.theme, item.subtheme, item.departmentId, item.requester, item.frequency, item.status, item.owner]);
  return h("div", { class: "dashboard-page" }, section("AI 需求机会", "把重复需求沉淀为可复用能力", panel("需求漏斗", `${summary.total || demands.length} 条有效需求`, h("div", { class: "funnel funnel--large" }, [["captured", "已收集"], ["assessed", "已评估"], ["designed", "已方案化"], ["delivered", "已交付"], ["reused", "已复用"]].map(([key, label]) => h("div", { class: "funnel__step" }, h("strong", { text: String(snapshot.overview?.demandFunnel?.counts?.[key] || 0) }), h("span", { text: label }))))), panel("高频需求与机会", `${summary.themes || 0} 个主题`, table(["主题", "二级主题", "部门", "提出人", "频次", "状态", "责任人"], rows, "本期没有需求明细"))));
}
