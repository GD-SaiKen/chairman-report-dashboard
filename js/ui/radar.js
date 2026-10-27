import { section, panel, table, h } from "./shared.js";

const typeLabel = { "ai-tool": "AI 工具", "agent-tool": "智能体工具", topic: "AI 话题" };
const decisionLabel = { watch: "关注", trial: "安排试用", adopt: "建议引入", reject: "暂不采用" };

export function renderRadar(snapshot) {
  const items = snapshot.radar?.items || [];
  const groups = ["ai-tool", "agent-tool", "topic"].map((type) => items.filter((item) => item.type === type));
  return h("div", { class: "dashboard-page" }, section("AI 前沿雷达", "自动候选 + 信息部审核，正式页面只展示已审核内容", ...groups.map((group, index) => panel(typeLabel[["ai-tool", "agent-tool", "topic"][index]], `${group.length} 条`, table(["项目", "热度", "公司相关性", "适用部门", "结论", "来源"], group.map((item) => [h("a", { href: item.url, target: "_blank", rel: "noopener noreferrer", text: item.name }), item.stars == null ? "—" : item.stars.toLocaleString("zh-CN"), item.companyFit, (item.applicableDepartments || []).join("、"), decisionLabel[item.decision] || item.decision, item.source]))))));
}
