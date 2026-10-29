import { h, icon, srText } from "../core/dom.js";
import { slugifyId } from "../core/snapshot-contract.js";
import { routeHref } from "../core/router.js";

export const fmt = (value) => value == null ? "—" : Number(value).toLocaleString("zh-CN");
export const fmtM = (value) => value == null ? "—" : value >= 1000000 ? `${(value / 1000000).toFixed(1)}M` : fmt(value);
export const pct = (value) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
export const fmtPercent = (value) => value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;

export function section(title, note, ...children) {
  // 中文标题不能直接当 id：含空格时 aria-labelledby 会被拆成多个 IDREF，读屏将读不出标题
  const id = `sec-${slugifyId(title)}`;
  return h("section", { class: "dash-section", "aria-labelledby": id },
    h("div", { class: "dash-section__head" }, h("div", null, h("h2", { id, text: title }), note ? h("p", { text: note }) : null)),
    ...children
  );
}

export function panel(title, meta, ...children) {
  return h("article", { class: "dash-panel" }, h("header", { class: "dash-panel__head" }, h("h3", { text: title }), meta ? h("span", { class: "dash-panel__meta", text: meta }) : null), h("div", { class: "dash-panel__body" }, ...children));
}

export function kpi(label, value, hint, tone = "info") {
  return h("article", { class: `dash-kpi dash-kpi--${tone}` }, h("span", { class: "dash-kpi__label", text: label }), h("strong", { class: "dash-kpi__value", text: fmt(value) }), hint ? h("span", { class: "dash-kpi__hint", text: hint }) : null);
}

export function empty(text = "暂无数据") {
  return h("p", { class: "dash-empty", role: "status" }, icon("database", "16"), h("span", { text }));
}

export function qualityBadge(quality = {}) {
  const status = quality.status || "ok";
  const label = { ok: "数据正常", warning: "有数据警告", stale: "数据已过期", missing: "数据缺失" }[status] || "需检查";
  return h("span", { class: `quality quality--${status}`, title: (quality.warnings || []).join("；") }, label);
}

export function bar(value, max, label) {
  const width = max ? Math.max(4, Math.round((value / max) * 100)) : 4;
  return h("div", { class: "dash-bar-row" }, h("span", { class: "dash-bar-label", text: label }), h("span", { class: "dash-bar-track" }, h("i", { class: "dash-bar-fill", style: { width: `${width}%` } })), h("b", { text: fmt(value) }));
}

/** 单元格文本：NaN 这类无效数字一律显示「—」，绝不能把 JS 值原样吐到页面上 */
function cellText(cell) {
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "—";
  return cell == null ? "—" : String(cell);
}

export function table(headers, rows, emptyText = "暂无明细") {
  if (!rows.length) return empty(emptyText);
  return h("div", { class: "dash-table-wrap" }, h("table", { class: "dash-table" }, h("thead", null, h("tr", null, headers.map((header) => h("th", { text: header })))), h("tbody", null, rows.map((row) => h("tr", null, row.map((cell) => h("td", null, cell?.nodeType ? cell : cellText(cell))))))));
}

export function linkButton(route, text, query) {
  return h("a", { class: "btn btn--ghost", href: routeHref(route, query) }, text, icon("arrow-right", "14"));
}

export { h, icon, srText };
