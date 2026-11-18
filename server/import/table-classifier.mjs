/**
 * table-classifier.mjs — 周报表的语义识别
 *
 * 存在原因：信息部周报是人工排版的 HTML，表头每期都在漂——
 *   部门表：活跃人数 / 参与人数 / 发任务人数
 *   Token 表：来源+有效消耗 / 通道+合计(M)
 *   能力表：类型+名称+运行 / 能力+业务调用+真失败率
 * 死表头别名匹配必然跟不上，所以这里先认「每一列扮演什么角色」，再按角色组合判定表类型。
 * 认不出就返回 null，宁可漏抽，也不猜一个错的口径。
 */

/** 表头规范化：去空白、去空括号、转小写 */
function canon(value) {
  return String(value ?? "")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[（(]\s*[)）]/g, "")
    .toLowerCase();
}

/** 「合计(M)」「Token（M）」→ 基名 + 数量级；「提出人（条数）」这类非数量级括号只剥括号 */
export function splitUnit(header) {
  const raw = String(header ?? "").replace(/[\s\u3000]+/g, "");
  const matched = raw.match(/[（(]([^）)]*)[)）]\s*$/);
  if (!matched) return { base: canon(raw), unit: 1 };
  const base = canon(raw.slice(0, matched.index));
  const unitText = matched[1].replace(/\s/g, "").toUpperCase();
  const unit = { M: 1e6, 百万: 1e6, K: 1e3, 千: 1e3, G: 1e9, 万: 1e4, 亿: 1e8 }[unitText] ?? 1;
  return { base, unit };
}

/** 列角色 → 表头正则；顺序不影响判定，判定按角色组合走 */
const ROLE_PATTERNS = [
  ["rank", /^(名次|排名|序号|#|编号)$/],
  ["department", /^(部门|一级部门|归口|部门名称)$/],
  ["user", /^(用户|姓名|账号|人员|成员)$/],
  ["people", /(人数|人员数|用户数|参与人数|发任务人数|活跃人数|活跃人员|活跃用户|账号数)$/],
  ["capability", /^(能力|工具|技能|能力名称|工具名称|智能体|agent)$/],
  ["type", /^(类型|分类)$/],
  ["channel", /^(通道|来源|平台|渠道|项目|模型)$/],
  ["metric", /^(指标|度量|项目|事项)$/],
  ["current", /^(本期|本周|当期|数值|当前)$/],
  ["previous", /^(上期|上周|对比值)$/],
  ["change", /^(变化|环比|同比|增幅)$/],
  ["runs", /^(运行|业务调用|调用|调用次数|执行次数|run|业务run|总run|业务运行)$/],
  ["failures", /^(失败|真失败|异常数|失败数)$/],
  ["failRate", /(失败率|成功率)$/],
  ["share", /^(占比|比重|份额)$/],
  ["effective", /^(有效消耗|有效token|有效使用)$/],
  ["demands", /^(有效需求|需求条数|有效条数|条数|需求数)$/],
  ["theme", /^(主题|需求主题|话题|话题关键词命中)$/],
  ["requester", /^(提出人|申请人|需求方|主要提出人)$/],
  ["status", /^(状态|进展|结论|关键结论|状态与关键结论)$/],
  ["input", /^输入/],
  ["output", /^输出/],
  ["total", /^(合计|总量|总计|token总量|总消耗)(token|数)?$/],
  ["requests", /^(请求|请求数|调用量)$/],
  ["cache", /^缓存(读取|读)?$/],
  ["description", /^(说明|备注|说明备注)$/],
  ["url", /^(链接|地址|网址|url)$/],
  ["name", /^(名称|项目名称|工具名称)$/],
];

function roleOf(base) {
  for (const [role, pattern] of ROLE_PATTERNS) if (pattern.test(base)) return role;
  return null;
}

/** 表头 → { role: {index, unit} }；同名列取第一处 */
export function columnRoles(headers = []) {
  const roles = {};
  headers.forEach((header, index) => {
    const { base, unit } = splitUnit(header);
    const role = roleOf(base);
    if (role && !(role in roles)) roles[role] = { index, unit, header: String(header ?? "") };
  });
  return roles;
}

/**
 * 判定表类型。
 * @returns {{kind: string|null, roles: object}} kind ∈ scale|departments|capabilities|tokens|demands|people|radar|null
 */
export function classifyTable(rows = []) {
  if (!Array.isArray(rows) || rows.length < 2) return { kind: null, roles: {} };
  const roles = columnRoles(rows[0]);
  const has = (...names) => names.every((name) => name in roles);

  // 逐人明细表（名次+用户+部门）不是部门汇总，先排除
  if (has("rank", "user")) {
    if (has("capability") || has("status")) return { kind: "radar", roles };
    return { kind: "people", roles };
  }
  // 规模指标带：指标 × 本期/上期
  if (has("metric", "current") || has("metric", "previous")) return { kind: "scale", roles };
  // 部门汇总：部门 + 人数类列
  if (has("department", "people")) return { kind: "departments", roles };
  // 能力表：能力 + 调用/运行/失败
  if (has("capability") && (has("runs") || has("failures") || has("failRate"))) return { kind: "capabilities", roles };
  // 通道路径的 Token 表
  if (has("channel") && (has("total") || has("requests") || has("effective") || has("cache") || (has("input") && has("output")))) return { kind: "tokens", roles };
  // 需求主题表
  if (has("theme") && (has("requester") || has("status"))) return { kind: "demands", roles };
  // 雷达候选表（有结论/链接）
  if (has("name", "status") || has("name", "url")) return { kind: "radar", roles };
  return { kind: null, roles };
}

/** 「4,949.11M」「89.8K」「1,366.25」→ 数值；列单位优先于后缀 */
export function parseQuantity(value, unit = 1) {
  const text = String(value ?? "").trim().replace(/[,，\s]/g, "");
  if (!text || text === "—" || text === "-" || text === "–") return null;
  const matched = text.match(/^(-?\d+(?:\.\d+)?)([kKmMgG万]|百万|亿)?/);
  if (!matched) return null;
  const suffix = { k: 1e3, m: 1e6, g: 1e9, 万: 1e4, 百万: 1e6, 亿: 1e8 }[String(matched[2] ?? "").toLowerCase()] ?? 1;
  const scale = unit && unit !== 1 ? unit : suffix;
  return Number(matched[1]) * scale;
}

/** 「90.7%」「13.2%」→ 0.907 / 0.132 */
export function parseRate(value) {
  const matched = String(value ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*%$/);
  return matched ? Number(matched[1]) / 100 : null;
}

/** 规模指标带里的指标名 → 快照 KPI 键；认不出返回 null（绝不猜） */
export const METRIC_ALIASES = {
  // 只收「同一个东西的另一种叫法」。「活跃账号」是 agent 平台的账号数、
  // 「有效需求条数」是消息条数，与 dsh-work 的业务口径不是一回事，不能混进来。
  activeUsers: ["业务活跃用户", "活跃用户", "活跃人员", "业务用户"],
  taskUsers: ["发任务用户", "发任务人数", "任务用户"],
  newUsers: ["新用户", "新增用户"],
  repeatUsers: ["回访用户", "重复用户", "复用用户"],
  runs: ["业务run", "总run", "run总数", "业务运行", "业务运行次数"],
  successRate: ["业务成功率", "成功率"],
  activeAgents: ["活跃agent", "agent数", "智能体数", "活跃智能体"],
  activeSkills: ["活跃skill", "skill数", "技能数", "活跃技能"],
};

export function metricKey(name) {
  const text = canon(name);
  for (const [key, aliases] of Object.entries(METRIC_ALIASES)) {
    if (aliases.some((alias) => text === canon(alias) || text.startsWith(canon(alias)))) return key;
  }
  return null;
}

/** 丢掉「合计 / 总计 / —」这类汇总行，避免把总量当明细重复累加 */
export function isSummaryRow(cells = []) {
  const first = String(cells[0] ?? "").trim();
  const second = String(cells[1] ?? "").trim();
  // 「合计（25 把有量 / 共 54 把）」这类带括号说明的汇总行
  if (/^(合计|总计|小计|汇总|全部)/.test(first) || /^(合计|总计|小计|汇总|全部)/.test(second)) return true;
  // 名次榜的汇总行是「— | 14 个部门 | …」
  if (/^[—\-－–]$/.test(first)) return true;
  if (/^\d+\s*个(部门|账号|人)/.test(second) || /^(全部|所有)/.test(second)) return true;
  return false;
}

/** 部门名清洗：「BC AL组装 / 模具加工 / 压铸车间」保留原样，「未归属」标记出来 */
export function cleanDepartmentName(value) {
  return String(value ?? "").replace(/[\s\u3000]+/g, " ").trim();
}

export function isUnassigned(name) {
  return /^(未归属|未知|其他|其它|未分类)$/.test(cleanDepartmentName(name));
}
