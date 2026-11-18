import { section, panel, fmt, fmtM, pct, table, h } from "./shared.js";
import { routeHref } from "../core/router.js";

/** 求和；全部缺失时返回 null，避免 undefined+undefined 变成 NaN 显示到页面上 */
function sumValues(...values) {
  // Number(null) === 0：不先排除空值，缺失的「活跃能力」会被算成 0 并显示成「0 项」
  const parts = values.filter((value) => value != null && value !== "" && Number.isFinite(Number(value)));
  return parts.length ? parts.reduce((total, value) => total + Number(value), 0) : null;
}

function pair(left, right) {
  return left == null && right == null ? "—" : `${fmt(left)} / ${fmt(right)}`;
}

export function renderDepartments(snapshot, query = {}) {
  const departments = snapshot.departments?.departments || [];
  const selected = departments.find((item) => item.id === query.department);
  const rows = departments.map((item) => [
    // 部门名是下钻入口，否则 ?department= 路径没有任何可达方式
    item.id
      ? h("a", { class: "dash-link", href: routeHref("departments", { department: item.id }), text: item.name })
      : item.name,
    fmt(item.activeUsers),
    pair(item.newUsers, item.repeatUsers),
    fmt(item.validDemands),
    fmtM(item.tokens?.effective),
    fmt(sumValues(item.activeSkills, item.activeAgents)),
    fmt(item.outputs),
  ]);
  return h("div", { class: "dashboard-page" },
    section("部门 AI 采用", "按部门比较，点击部门名后进入实名下钻",
      panel("部门排序", `${departments.length} 个活跃部门`, table(["部门", "活跃人数", "新增 / 复用", "有效需求", "有效 Token", "活跃能力", "成功产出"], rows))),
    selected ? renderDepartmentDetail(selected) : h("p", { class: "dash-hint", text: "选择一个部门查看团队、人员和主要需求主题。" })
  );
}

function renderDepartmentDetail(department) {
  // Number(null) === 0：不用 num() 包一层，「复用人数」缺失会显示成 0 人、复用率 0.0%
  const num = (value) => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
  const activeUsers = num(department.activeUsers);
  const repeatUsers = num(department.repeatUsers);
  // 复用率只有两个数字都已知时才计算，缺失时显示「—」而不是 0%
  const repeatRate = activeUsers && repeatUsers != null ? repeatUsers / activeUsers : null;
  const capabilities = sumValues(department.activeSkills, department.activeAgents);

  return section(`${department.name} · 部门画像`, "实名明细仅面向驾驶舱受控用户",
    h("div", { class: "dash-grid-3" },
      panel("采用指标", `${fmt(activeUsers)} 人活跃`, h("div", { class: "stat-pairs" },
        h("span", null, h("b", { text: fmt(department.newUsers) }), "新增"),
        h("span", null, h("b", { text: fmt(repeatUsers) }), "复用"),
        h("span", null, h("b", { text: pct(repeatRate) }), "复用率"))),
      panel("主要主题", "来自需求归类", h("ul", { class: "dash-list" }, (department.topThemes || []).map((theme) => h("li", { text: theme })))),
      panel("能力与 Token", "有效消耗与缓存分开", h("div", { class: "stat-pairs" },
        h("span", null, h("b", { text: fmtM(department.tokens?.effective) }), "有效 Token"),
        h("span", null, h("b", { text: fmtM(department.tokens?.cacheRead) }), "缓存读取"),
        h("span", null, h("b", { text: fmt(department.outputs) }), "成功产出")))),
    h("div", { class: "dash-detail-note" }, `团队：${(department.teams || []).join("、")} · 活跃 Skills ${fmt(department.activeSkills)} · 活跃 Agents ${fmt(department.activeAgents)}`)
  );
}
