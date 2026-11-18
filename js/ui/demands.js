import { section, panel, fmt, table, h } from "./shared.js";

const STAGES = [
  ["captured", "已收集"],
  ["assessed", "已评估"],
  ["designed", "已方案化"],
  ["delivered", "已交付"],
  ["reused", "已复用"],
];

export function renderDemands(snapshot) {
  const summary = snapshot.demands?.summary || {};
  const demands = snapshot.demands?.demands || [];
  const counts = snapshot.overview?.demandFunnel?.counts || {};
  // 导入的周报常只给「需求主题」表，没有分阶段状态；此时漏斗全是 0，
  // 不能把它当成真实分布展示，否则读者会以为本期一条需求都没有。
  const hasStages = STAGES.some(([key]) => Number(counts[key]) > 0);
  const funnel = hasStages
    ? h("div", { class: "funnel funnel--large" }, STAGES.map(([key, label]) => h("div", { class: "funnel__step" }, h("strong", { text: fmt(counts[key]) }), h("span", { text: label }))))
    : h("p", { class: "dash-hint", text: "报告未提供需求的分阶段状态，本期只列出需求主题。" });
  const rows = demands.map((item) => [item.theme, item.subtheme, item.departmentId, item.requester, item.frequency, item.status, item.owner]);

  return h("div", { class: "dashboard-page" },
    section("AI 需求机会", "把重复需求沉淀为可复用能力",
      panel("需求漏斗", `${fmt(summary?.total)} 条需求条目`, funnel),
      panel("高频需求与机会", `${fmt(summary?.themes)} 个主题`, table(["主题", "二级主题", "部门", "提出人", "频次", "状态", "责任人"], rows, "本期没有需求明细"))));
}
