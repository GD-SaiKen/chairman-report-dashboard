import { section, panel, kpi, bar, fmt, fmtM, pct, linkButton, h } from "./shared.js";

function displayAsOf(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function renderOverview(snapshot) {
  const overview = snapshot.overview || {};
  const report = overview.report;
  const digest = overview.digest || {};
  const highlights = (digest.highlights || []).slice(0, 3);
  const watchItems = (digest.watchItems || []).slice(0, 2);
  const kpis = overview.kpis || {};
  const departments = snapshot.departments?.departments || [];
  const funnel = overview.demandFunnel?.counts || {};
  const capabilities = overview.capabilities || {};
  const tokens = overview.tokens || {};
  const radar = snapshot.radar?.items || [];
  const sourceNames = { sino: "Sino WebUI", hermes: "Hermes WebUI", departments: "部门记录", "legacy-catalog": "历史目录" };
  const dataSources = (snapshot.quality?.sources || []).filter((item) => item.id && item.id !== "aikey" && item.status !== "missing");
  const sourceLine = dataSources.map((item) => `${sourceNames[item.id] || item.id}${item.asOf ? `（${item.asOf}）` : ""}`).join(" · ");
  const maxUsers = Math.max(...departments.map((item) => item.activeUsers || 0), 1);
  const demandRows = snapshot.demands?.demands || [];
  // 分阶段状态与可复用标记都可能整列为空：此时 0 是「没抽到」，不是「确实是 0」
  const hasStages = Object.values(funnel).some((value) => Number(value) > 0);
  const hasReusable = demandRows.some((item) => typeof item.reusable === "boolean");
  const agentsHint = capabilities.runs == null ? "运行次数未提供" : `${fmt(capabilities.runs)} 次运行`;

  return h("div", { class: "dashboard-page" },
    h("section", { class: "dashboard-hero digest-hero" },
      h("div", null,
        h("p", { class: "hero__eyebrow", text: `信息部报告 · ${snapshot.period.window}` }),
        h("h1", { text: digest.headline || report?.title || "公司 AI 运转报告" }),
        h("p", { class: "hero__sub", text: digest.summary || `数据截至 ${displayAsOf(snapshot.period.asOf)}。${report?.localPath ? "本页提炼本期重点，可继续阅读完整报告。" : "本页展示本期已有的关键数据与专题资料。"}` }),
        report?.localPath ? h("a", { class: "btn btn--primary digest-read", href: report.localPath, text: "阅读全文　→" }) : h("p", { class: "digest-missing", text: "本期全文尚未发布" })
      ),
      h("div", { class: "hero__signal digest-date" }, h("strong", { text: snapshot.period.label }), h("span", { text: `截至 ${displayAsOf(snapshot.period.asOf)}` }))
    ),
    highlights.length || watchItems.length ? section("本期要点", digest.reviewer ? `从报告提取 · ${digest.reviewer}审核` : "据报告原文整理", h("div", { class: "digest-grid" },
      highlights.length ? panel("关键进展", `${highlights.length} 项`, h("ol", { class: "digest-list" }, highlights.map((item) => h("li", { text: typeof item === "string" ? item : item.text })))) : null,
      watchItems.length ? panel("待关注", `${watchItems.length} 项`, h("ul", { class: "digest-list digest-list--watch" }, watchItems.map((item) => h("li", { text: typeof item === "string" ? item : item.text })))) : null
    )) : null,
    section("关键数据", "仅展示本期可核对的运营信号", h("div", { class: "dash-kpis" },
      kpi("活跃部门", kpis.activeDepartments, "一级部门"), kpi("活跃人员", kpis.activeUsers, "产生有效业务需求"),
      kpi("需求条目", kpis.validDemands, "去重后的需求条目"), kpi("活跃 Agents", kpis.activeAgents, agentsHint)
    ), sourceLine ? h("p", { class: "dash-source", text: `核对来源：${sourceLine}` }) : null),
    section("专题数据", "需要进一步核对时，进入对应专题", h("div", { class: "digest-topics" },
      panel("部门采用", `${departments.length} 个部门`, departments.length ? h("div", { class: "dash-bars" }, departments.slice(0, 5).map((item) => bar(item.activeUsers || 0, maxUsers, item.name))) : null, linkButton("departments", "查看部门")),
      panel("需求机会", `${hasReusable ? fmt(overview.demandFunnel?.opportunities) : "—"} 个可复用机会`, h("p", { class: "dash-hint", text: hasStages ? `${fmt(funnel.delivered)} 项已交付 · ${fmt(funnel.reused)} 项已复用` : "报告未提供需求的分阶段状态" }), linkButton("demands", "查看需求")),
      panel("能力与 Token", `${fmt(capabilities.active)} 项能力活跃`, h("p", { class: "dash-hint", text: `${pct(capabilities.successRate)} 成功率 · ${fmtM(tokens.effective)} 有效 Token` }), linkButton("capabilities", "查看能力"), linkButton("tokens", "查看 Token")),
      panel("AI 前沿雷达", `${radar.length} 条已审核`, h("p", { class: "dash-hint", text: "仅展示经信息部审核的候选" }), linkButton("radar", "查看雷达"))
    )),
    snapshot.quality?.warnings?.length ? section("数据说明", "阅读数字时请留意以下口径", panel("质量提醒", `${snapshot.quality.warnings.length} 条`, h("ul", { class: "dash-list" }, snapshot.quality.warnings.map((warning) => h("li", { text: warning }))))) : null
  );
}
