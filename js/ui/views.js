/**
 * ui/views.js — 视图层
 *
 * 每个 render* 函数接收纯数据、返回一个 DOM 节点（无副作用、不读全局状态），
 * 因此可单独调用、可快照测试、也可被任意容器复用。
 */

import { h, icon, srText } from "../core/dom.js";
import { sourceMeta, sortDecisions } from "../core/catalog.js";

/* ============================ 侧栏 ============================ */

export function renderBrand(site) {
  return h(
    "div",
    { class: "brand" },
    h("span", { class: "brand__mark", "aria-hidden": "true" }, icon("layout-dashboard", "20")),
    h(
      "div",
      null,
      h("p", { class: "brand__title", text: site.title }),
      h("p", { class: "brand__sub", text: site.subtitle })
    )
  );
}

/** 舱面锚点 + 报告全文入口 */
export function renderNav(period) {
  const cockpit = [
    { href: "#meters", icon: "gauge", label: "仪表带" },
    { href: "#judgments", icon: "list-checks", label: "本期判断" },
    { href: "#risks", icon: "alert-triangle", label: "风险灯" },
    { href: "#decisions", icon: "list-checks", label: "待决策" },
  ].map((item) =>
    h(
      "a",
      { class: "nav__link", href: item.href, dataset: { nav: "section" } },
      icon(item.icon),
      h("span", { text: item.label })
    )
  );

  const reports = period.reports.map((r) =>
    h(
      "a",
      {
        class: "nav__link",
        href: r.localPath || r.onlineUrl,
        ...(r.localPath ? {} : { target: "_blank", rel: "noopener noreferrer" }),
      },
      icon("file-text"),
      h("span", { text: r.title })
    )
  );

  return h(
    "nav",
    { class: "nav", "aria-label": "驾驶舱导航" },
    h("p", { class: "nav__group", text: "舱面" }),
    cockpit,
    h("p", { class: "nav__group", text: "报告全文" }),
    reports.length ? reports : h("p", { class: "nav__group", text: "暂无报告" })
  );
}

export function renderSidebarFoot(period) {
  return h(
    "div",
    { class: "sidebar__foot" },
    h("b", { text: "数据窗口" }),
    h("br"),
    period.window,
    h("br"),
    h("span", { text: `更新 ${period.updated}` })
  );
}

/* ============================ 顶栏 ============================ */

export function renderPeriodOptions(catalog, currentId) {
  return catalog.periods.map((p) =>
    h("option", { value: p.id, selected: p.id === currentId }, p.label)
  );
}

export function selectField(catalog, currentId) {
  return h(
    "div",
    { class: "field" },
    h("label", { class: "sr-only", for: "period-select", text: "选择期次" }),
    h("select", { class: "field__select", id: "period-select" }, renderPeriodOptions(catalog, currentId))
  );
}

/* ============================ Hero 结论条 ============================ */

export function renderHero(site, period, stats) {
  const facts = [
    { color: "var(--danger-500)", num: stats.red, label: "红灯" },
    { color: "var(--warn-500)", num: stats.amber, label: "黄灯" },
    { color: "var(--brand-500)", num: stats.decisions, label: "待决策" },
    { color: "var(--ink-400)", num: stats.reports, label: "报告" },
  ].map((f) =>
    h(
      "li",
      { class: "fact" },
      h("span", { class: "fact__dot", style: { background: f.color }, "aria-hidden": "true" }),
      h("span", { class: "fact__num", text: String(f.num) }),
      h("span", { class: "fact__label", text: f.label })
    )
  );

  return h(
    "section",
    { class: "hero reveal", "aria-labelledby": "hero-title" },
    h(
      "div",
      null,
      h(
        "p",
        { class: "hero__eyebrow" },
        icon("calendar", "14"),
        h("span", { text: `数据窗口 ${period.window}` })
      ),
      h("h1", { class: "hero__title", id: "hero-title", text: site.title }),
      h("p", { class: "hero__sub", text: `${site.subtitle}｜${stats.headline}` })
    ),
    h("ul", { class: "facts", "aria-label": "本期要点计数" }, facts)
  );
}

/* ============================ 区块容器 ============================ */

function section({ id, title, note, children, className = "" }) {
  return h(
    "section",
    { class: `section ${className}`.trim(), id, "aria-labelledby": `${id}-title` },
    [
      h(
        "header",
        { class: "section__head" },
        h("h2", { class: "section__title", id: `${id}-title`, text: title }),
        note ? h("p", { class: "section__note", text: note }) : null
      ),
      ...children,
    ]
  );
}

/** 带图标标题的面板（判断 / 风险 / 待决策共用） */
function panel({ icon: iconName, title, count, body }) {
  return h(
    "article",
    { class: "panel" },
    h(
      "header",
      { class: "panel__head" },
      h("span", { class: "panel__icon", "aria-hidden": "true" }, icon(iconName)),
      h("h3", { class: "panel__title", text: title }),
      count != null ? h("span", { class: "panel__count", text: count }) : null
    ),
    h("div", { class: "panel__body" }, body)
  );
}

/* ============================ 仪表带 ============================ */

export function renderMeters(period) {
  const cards = period.meters.map((m, i) => {
    const src = sourceMeta(m.source);
    return h(
      "li",
      { class: "kpi-card reveal", style: { "--i": String(i) } },
      h(
        "span",
        { class: "kpi-card__src" },
        icon(src.icon, "14"),
        h("span", { text: src.label })
      ),
      h(
        "p",
        { class: "kpi-card__value" },
        h("span", { dataset: { count: m.value }, "aria-hidden": "true", text: "0" }),
        m.unit ? h("small", { class: "kpi-card__unit", "aria-hidden": "true", text: m.unit }) : null
      ),
      h("p", { class: "kpi-card__label", text: m.label }),
      m.hint ? h("p", { class: "kpi-card__hint", text: m.hint }) : null,
      // 滚动动画期间数字不可读，为读屏单独提供定值文本
      srText(`${m.label} ${m.value}${m.unit}，来源 ${src.label}`)
    );
  });

  return section({
    id: "meters",
    title: "仪表带",
    note: "口径分源，舱内不做跨报告加总",
    children: [h("ul", { class: "kpi" }, cards)],
  });
}

/* ============================ 本期判断 ============================ */

export function renderJudgments(period) {
  const items = period.judgments.map((j, i) =>
    h(
      "li",
      { class: "judge" },
      h("span", { class: "judge__no", "aria-hidden": "true", text: String(i + 1).padStart(2, "0") }),
      h(
        "div",
        null,
        h("p", { class: "judge__text", text: j.text }),
        j.source ? h("span", { class: "judge__src", text: `来源 · ${sourceMeta(j.source).label}` }) : null
      )
    )
  );

  return section({
    id: "judgments",
    title: "本期判断",
    note: `${period.judgments.length} 条`,
    children: [
      panel({
        icon: "list-checks",
        title: "结论要点",
        count: `${period.judgments.length} 条`,
        body: h("ol", { class: "judges" }, items),
      }),
    ],
  });
}

/* ============================ 风险灯 ============================ */

export function renderRisks(period) {
  const items = period.risks.map((r) => {
    const isRed = r.level === "red";
    return h(
      "li",
      { class: `risk ${isRed ? "risk--red" : "risk--amber"}` },
      h("span", { class: "risk__rail", "aria-hidden": "true" }),
      h(
        "div",
        null,
        h(
          "div",
          { class: "risk__row" },
          // 灯色不只用颜色表达：同时给出「红灯 / 黄灯」文字
          h("span", { class: `pill pill--${isRed ? "danger" : "warn"}`, text: isRed ? "红灯" : "黄灯" }),
          h("p", { class: "risk__fact", text: r.fact })
        ),
        h("p", { class: "risk__mean", text: r.meaning })
      )
    );
  });

  return section({
    id: "risks",
    title: "风险灯",
    note: "红灯需当场收口，黄灯需点名跟进",
    children: [
      panel({
        icon: "alert-triangle",
        title: "风险清单",
        count: `${period.risks.length} 项`,
        body: h("ul", { class: "risks" }, items),
      }),
    ],
  });
}

/* ============================ 待决策 ============================ */

export function renderDecisions(period) {
  const items = sortDecisions(period.decisions).map((d) =>
    h(
      "li",
      { class: "task" },
      h(
        "div",
        { class: "task__row" },
        h("p", { class: "task__item", text: d.item }),
        h("span", { class: `pill pill--${d.tone}`, text: d.status })
      ),
      h("p", { class: "task__owner", text: `责任人 · ${d.owner}` })
    )
  );

  return section({
    id: "decisions",
    title: "待决策 / 盯办",
    note: "按紧急度排序",
    children: [
      panel({
        icon: "list-checks",
        title: "待办事项",
        count: `${period.decisions.length} 项`,
        body: h("ul", { class: "tasks" }, items),
      }),
    ],
  });
}

/* ============================ 报告入口 ============================ */

export function renderDoors(period) {
  const doors = period.reports.map((r) =>
    h(
      "article",
      { class: "door reveal", style: { "--i": "0" } },
      h(
        "div",
        { class: "door__head" },
        h("span", { class: "door__icon", "aria-hidden": "true" }, icon("file-text")),
        h("h3", { class: "door__title", text: r.title })
      ),
      r.window ? h("p", { class: "door__win" }, icon("clock", "14"), h("span", { text: r.window })) : null,
      r.scope ? h("p", { class: "door__scope", text: r.scope }) : null,
      h(
        "div",
        { class: "door__actions" },
        r.localPath
          ? h("a", { class: "btn btn--primary", href: r.localPath }, h("span", { text: "阅读全文" }), icon("arrow-right", "14"))
          : null,
        r.onlineUrl
          ? h(
              "a",
              { class: "btn btn--ghost", href: r.onlineUrl, target: "_blank", rel: "noopener noreferrer" },
              h("span", { text: "线上原件" }),
              icon("external-link", "14")
            )
          : null
      )
    )
  );

  return section({
    id: "reports",
    title: "报告全文",
    note: "舱内只做判断，细节回到原文",
    children: [h("div", { class: "doors" }, doors)],
  });
}

/* ============================ 状态视图 ============================ */

export function renderLoading() {
  return h(
    "div",
    { class: "section", role: "status", "aria-live": "polite" },
    h("div", { class: "kpi" }, Array.from({ length: 6 }, () => h("div", { class: "skeleton" }))),
    h("p", { class: "sr-only", text: "正在加载驾驶舱数据" })
  );
}

export function renderError(message) {
  return h(
    "div",
    { class: "state", role: "alert" },
    h("div", { class: "state__icon", "aria-hidden": "true" }, icon("alert-triangle", "20")),
    h("h2", { class: "state__title", text: "驾驶舱未能加载" }),
    h("p", { class: "state__text", text: message }),
    h(
      "p",
      { class: "state__text" },
      h("span", { text: "可在项目根目录执行 " }),
      h("code", { text: "npx serve . -l 5175" }),
      h("span", { text: " 后访问 http://localhost:5175" })
    )
  );
}

export function renderFoot(period) {
  return h(
    "footer",
    { class: "page-foot" },
    `数据摘自当期信息部周报与 Hermes 双周报 · 更新 ${period.updated}`
  );
}
