import { section, panel, fmt, fmtM, pct, table, h } from "./shared.js";

export function renderDepartments(snapshot, query = {}) {
  const departments = snapshot.departments?.departments || [];
  const selected = departments.find((item) => item.id === query.department);
  const rows = departments.map((item) => [item.name, item.activeUsers, `${item.newUsers} / ${item.repeatUsers}`, item.validDemands, fmtM(item.tokens?.effective), item.activeSkills + item.activeAgents, item.outputs]);
  return h("div", { class: "dashboard-page" }, section("部门 AI 采用", "一级部门比较，点击部门名后进入实名下钻", panel("部门排序", `${departments.length} 个活跃部门`, table(["部门", "活跃人数", "新增 / 复用", "有效需求", "有效 Token", "活跃能力", "成功产出"], rows))), selected ? renderDepartmentDetail(selected) : h("p", { class: "dash-hint", text: "选择一个部门查看团队、人员和主要需求主题。" }));
}

function renderDepartmentDetail(department) {
  return section(`${department.name} · 部门画像`, "实名明细仅面向驾驶舱受控用户", h("div", { class: "dash-grid-3" }, panel("采用指标", `${department.activeUsers} 人活跃`, h("div", { class: "stat-pairs" }, h("span", null, h("b", { text: fmt(department.newUsers) }), "新增"), h("span", null, h("b", { text: fmt(department.repeatUsers) }), "复用"), h("span", null, h("b", { text: pct(department.activeUsers ? department.repeatUsers / department.activeUsers : null) }), "复用率"))), panel("主要主题", "来自需求归类", h("ul", { class: "dash-list" }, (department.topThemes || []).map((theme) => h("li", { text: theme })))), panel("能力与 Token", "有效消耗与缓存分开", h("div", { class: "stat-pairs" }, h("span", null, h("b", { text: fmtM(department.tokens?.effective) }), "有效 Token"), h("span", null, h("b", { text: fmtM(department.tokens?.cacheRead) }), "缓存读取"), h("span", null, h("b", { text: fmt(department.outputs) }), "成功产出")))), h("div", { class: "dash-detail-note" }, `团队：${(department.teams || []).join("、")} · 活跃 Skills ${department.activeSkills} · 活跃 Agents ${department.activeAgents}`));
}
