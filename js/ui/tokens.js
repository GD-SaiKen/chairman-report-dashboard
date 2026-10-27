import { section, panel, fmtM, pct, table, h } from "./shared.js";

export function renderTokens(snapshot) {
  const summary = snapshot.tokens?.summary || snapshot.overview?.tokens || {};
  const departments = snapshot.tokens?.byDepartment || [];
  const platforms = snapshot.tokens?.byPlatform || [];
  const stats = h("div", { class: "dash-kpis" }, panel("有效消耗", "未缓存输入 + 输出", h("strong", { class: "metric-xl", text: fmtM(summary.effective) })), panel("上下文重读", `${pct(summary.cacheRate)} 占比`, h("strong", { class: "metric-xl", text: fmtM(summary.cacheRead) })), panel("非业务消耗", "测试 / 系统 / 审批", h("strong", { class: "metric-xl", text: fmtM(summary.nonBusiness) })), panel("网关对账", "不加入业务总量", h("strong", { class: "metric-xl", text: fmtM(summary.reconciliationOnly) })));
  const tables = h("div", { class: "dash-grid-2" }, panel("按部门", "有效 Token", table(["部门", "有效消耗", "缓存读取", "非业务"], departments.map((item) => [item.departmentId, fmtM(item.effective), fmtM(item.cacheRead), fmtM(item.nonBusiness)]))), panel("按平台", "主口径与对账口径", table(["平台", "有效消耗", "缓存读取", "分类"], platforms.map((item) => [item.name, fmtM(item.effective), fmtM(item.cacheRead), item.reconciliationOnly ? "仅对账" : item.classification]))));
  return h("div", { class: "dashboard-page" }, section("Token 效率", "有效消耗、上下文重读、非业务消耗和对账口径分开呈现", stats), section("消耗拆解", "按部门与平台核对来源", tables), section("治理提示", "不把 Token 直接解释为个人绩效", panel("解读规则", "", h("ul", { class: "dash-list" }, h("li", { text: "缓存读取高，优先检查长会话压缩和上下文复用。" }), h("li", { text: "aikey gateway 只用于对账，不能与上游业务口径相加。" }), h("li", { text: "测试、探活和系统辅助调用单独列出，避免高估业务需求。" })))));
}
