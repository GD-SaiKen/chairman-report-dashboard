import { h, icon } from "./shared.js";

const NAV = [
  ["overview", "报告导读", "file-text"],
  ["departments", "部门 AI 采用", "users"],
  ["demands", "AI 需求机会", "list-checks"],
  ["capabilities", "Skills & Agents", "layers"],
  ["tokens", "Token 效率", "activity"],
  ["radar", "AI 前沿雷达", "sparkles"],
];

export function renderBrand(site) {
  return h("div", { class: "brand" }, h("a", { class: "brand__mark", href: "#overview", "aria-label": "回到公司总览" }, icon("layout-dashboard")), h("div", null, h("p", { class: "brand__title", text: site.title }), h("p", { class: "brand__sub", text: site.subtitle })));
}

export function renderNav(route) {
  return h("nav", { class: "nav", "aria-label": "报告与专题" }, h("p", { class: "nav__label", text: "信息部报告" }), ...NAV.map(([id, label, iconName]) => h("a", { class: `nav__link ${route === id ? "is-active" : ""}`, href: `#${id}`, "data-route": id, "aria-current": route === id ? "page" : null }, icon(iconName), h("span", { text: label }))));
}

export function renderSidebarFoot(period, quality) {
  return h("div", { class: "sidebar__foot" }, h("p", { text: `${period.label} · ${period.window}` }), quality);
}

export function selectField(manifest, currentId) {
  return h("label", { class: "field" }, h("span", { class: "sr-only", text: "选择期次" }), h("select", { class: "field__select", id: "period-select", "aria-label": "选择期次" }, manifest.periods.map((period) => h("option", { value: period.id, selected: period.id === currentId, text: period.label }))));
}

export function renderTopbar(period, quality) {
  return { crumb: period.label, quality };
}
