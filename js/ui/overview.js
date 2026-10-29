import { section, panel, kpi, bar, fmt, fmtM, pct, linkButton, h } from "./shared.js";

export function renderOverview(snapshot) {
  const overview = snapshot.overview || {};
  const kpis = overview.kpis || {};
  const departments = snapshot.departments?.departments || [];
  const funnel = overview.demandFunnel?.counts || {};
  const capabilities = overview.capabilities || {};
  const tokens = overview.tokens || {};
  const radar = snapshot.radar?.items || [];
  const maxUsers = Math.max(...departments.map((item) => item.activeUsers || 0), 1);
  return h("div", { class: "dashboard-page" },
    h("section", { class: "dashboard-hero" }, h("div", null, h("p", { class: "hero__eyebrow", text: `数据窗口 ${snapshot.period.window}` }), h("h1", { text: "公司 AI 运转驾驶舱" }), h("p", { text: "先看普及程度，再看需求、能力、Token 与前沿变化。" })), h("div", { class: "hero__signal" }, h("strong", { text: `${fmt(kpis.activeDepartments)} 个活跃部门` }), h("span", { text: `${fmt(kpis.activeUsers)} 名活跃人员 · ${fmt(kpis.validDemands)} 条有效需求` }))),
    section("AI 普及总览", "当前不计算部门覆盖率，先观察活跃、复用和增长信号", h("div", { class: "dash-kpis" }, kpi("活跃部门", kpis.activeDepartments, "一级部门"), kpi("活跃人员", kpis.activeUsers, "产生有效业务需求"), kpi("新增用户", kpis.newUsers, "历史首次出现"), kpi("复用用户", kpis.repeatUsers, pct(kpis.repeatRate)), kpi("有效需求", kpis.validDemands, "去重后业务请求"), kpi("活跃 Agents", kpis.activeAgents, `${fmt(capabilities.runs)} 次运行`, "info"))),
    section("部门采用态势", "按活跃人员排序，点击进入实名与主题下钻", panel("一级部门热力", `${departments.length} 个部门`, departments.length ? h("div", { class: "dash-bars" }, departments.map((item) => bar(item.activeUsers || 0, maxUsers, item.name))) : null, linkButton("departments", "查看部门专题"))),
    section("AI 需求机会", "把重复需求变成可复用能力", panel("机会漏斗", `${fmt(overview.demandFunnel?.opportunities)} 个可复用机会`, h("div", { class: "funnel" }, ["captured", "assessed", "designed", "delivered", "reused"].map((state) => h("div", { class: "funnel__step" }, h("strong", { text: fmt(funnel[state] || 0) }), h("span", { text: { captured: "已收集", assessed: "已评估", designed: "已方案化", delivered: "已交付", reused: "已复用" }[state] })))), linkButton("demands", "查看需求机会"))),
    section("能力资产与 Token", "成功产出和有效消耗分开看", h("div", { class: "dash-grid-2" }, panel("Skills / Agents 产出", `${capabilities.successRate ? pct(capabilities.successRate) : "—"} 成功率`, h("div", { class: "stat-pairs" }, h("span", null, h("b", { text: fmt(capabilities.total) }), "资产"), h("span", null, h("b", { text: fmt(capabilities.active) }), "当期活跃"), h("span", null, h("b", { text: fmt(capabilities.outputs) }), "成功产出")), linkButton("capabilities", "查看能力资产")), panel("Token 结构", `${pct(tokens.cacheRate)} 缓存占比`, h("div", { class: "stat-pairs" }, h("span", null, h("b", { text: fmtM(tokens.effective) }), "有效消耗"), h("span", null, h("b", { text: fmtM(tokens.cacheRead) }), "上下文重读"), h("span", null, h("b", { text: fmtM(tokens.nonBusiness) }), "非业务消耗")), linkButton("tokens", "查看 Token 效率")))),
    section("本周 AI 前沿雷达", "自动候选由信息部审核后发布", panel("值得关注", `${radar.length} 条已审核`, h("div", { class: "radar-preview" }, radar.slice(0, 3).map((item) => h("a", { href: item.url, target: "_blank", rel: "noopener noreferrer" }, h("strong", { text: item.name }), h("span", { text: `${item.type === "topic" ? "话题" : item.type === "agent-tool" ? "智能体工具" : "AI 工具"} · ${item.decision}` })))), linkButton("radar", "查看完整雷达"))),
    snapshot.overview?.report ? section("报告归档", "保留原始周报全文入口", panel(snapshot.overview.report.title || "信息部周报", snapshot.overview.report.window || "", h("div", { class: "stat-pairs" }, h("span", null, h("a", { href: snapshot.overview.report.localPath, text: "打开本地全文" })), snapshot.overview.report.onlineUrl ? h("span", null, h("a", { href: snapshot.overview.report.onlineUrl, target: "_blank", rel: "noopener noreferrer", text: "打开线上原件" })) : null))) : null,
    snapshot.quality?.warnings?.length ? section("数据质量与管理提醒", "先处理口径，再解读趋势", panel("需要留意", `${snapshot.quality.warnings.length} 条`, h("ul", { class: "dash-list" }, snapshot.quality.warnings.map((warning) => h("li", { text: warning })))) ) : null
  );
}
