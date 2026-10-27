import { section, panel, fmt, pct, table, h } from "./shared.js";

export function renderCapabilities(snapshot) {
  const summary = snapshot.capabilities?.summary || snapshot.overview?.capabilities || {};
  const items = snapshot.capabilities?.capabilities || [];
  const rows = items.map((item) => [item.type, item.name, item.active ? "活跃" : "待修复/未启用", (item.departmentIds || []).join("、"), item.runs, item.successes, item.outputs, item.failureReason || "—"]);
  const stats = h("div", { class: "dash-kpis" },
    panel("资产总量", "按类型", h("div", { class: "stat-pairs" }, h("span", null, h("b", { text: fmt(summary.skills) }), "Skills"), h("span", null, h("b", { text: fmt(summary.agents) }), "Agents"), h("span", null, h("b", { text: fmt(summary.automations) }), "自动化"))),
    panel("运行质量", `${pct(summary.successRate)} 成功率`, h("div", { class: "stat-pairs" }, h("span", null, h("b", { text: fmt(summary.runs) }), "执行"), h("span", null, h("b", { text: fmt(summary.outputs) }), "产出"), h("span", null, h("b", { text: fmt(summary.failures) }), "失败")))
  );
  return h("div", { class: "dashboard-page" }, section("Skills & Agents", "资产数量只是起点，重点看活跃、执行和成功产出", stats), section("能力明细", "关联部门和需求，支持从失败回到待办", panel("能力资产清单", `${items.length} 条代表性资产`, table(["类型", "名称", "状态", "服务部门", "运行", "成功", "产出", "失败说明"], rows))));
}
