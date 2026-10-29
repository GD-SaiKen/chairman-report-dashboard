export function parseLocalizedNumber(value) {
  const normalized = String(value ?? "").trim().replace(/,/g, "");
  if (!normalized || normalized === "—") return null;
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)\s*([kKmMgG])?$/);
  if (!match) return null;
  const multiplier = { k: 1e3, m: 1e6, g: 1e9 }[match[2]?.toLowerCase()] || 1;
  return Number(match[1]) * multiplier;
}

export function parsePercent(value) {
  const match = String(value ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*%$/);
  return match ? Number(match[1]) / 100 : null;
}

function evidence(block, sourceFileId) {
  return { sourceFileId, sectionTitle: block.sectionTitle, blockId: block.id, locator: block.locator, excerpt: block.text.slice(0, 300), method: "rule", confidence: 1, reviewStatus: "pending" };
}

function indexHeaders(row = []) { return Object.fromEntries(row.map((value, index) => [String(value).replace(/\s/g, "").toLowerCase(), index])); }
function column(headers, ...names) { return names.map((name) => headers[name]).find((value) => value != null); }

const DEMAND_STATUS_ALIASES = {
  captured: ["已收集", "收集", "新提", "待评估"],
  assessed: ["已评估", "评估中"],
  designed: ["已方案化", "方案中", "设计中"],
  delivered: ["已交付", "交付"],
  reused: ["已复用", "复用"],
  closed: ["已关闭", "关闭", "完结"],
};

// 顺序敏感：「智能体工具」同时含「智能体」与「工具」，必须先匹配更具体的类别
const RADAR_TYPE_ALIASES = {
  "agent-tool": ["智能体工具", "agent工具", "智能体", "agent"],
  "ai-tool": ["ai工具", "ai 工具", "工具"],
  topic: ["话题", "主题", "趋势"],
};

const RADAR_DECISION_ALIASES = {
  watch: ["关注", "观察"],
  trial: ["安排试用", "试用", "试点"],
  adopt: ["建议引入", "引入", "采用"],
  reject: ["暂不采用", "不采用", "暂缓", "搁置"],
};

/** 中文标签 → 枚举值；无法识别时返回 null，绝不猜一个默认值 */
function matchAlias(value, aliases) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  for (const [key, words] of Object.entries(aliases)) {
    if (words.some((word) => text.includes(word.toLowerCase()))) return key;
  }
  return null;
}

/** 列表项里的需求条目：「需求：客诉分析」这类写法 */
function extractDemandsFromList(block, result, sourceFileId) {
  for (const item of block.items || []) {
    const matched = String(item).match(/^(?:需求|诉求)\s*[:：\-–]\s*(.+)$/);
    if (!matched) continue;
    result.demandCandidates.push({
      title: matched[1].trim(), theme: null, subtheme: null, departmentId: null,
      requester: null, frequency: null, status: null, reusable: null,
      evidence: evidence(block, sourceFileId),
    });
  }
}

/** 前沿小节里的外链：作为雷达候选，必须审核后才可发布 */
function extractRadarFromLink(block, result, sourceFileId) {
  const href = block.href || "";
  if (!/^https?:\/\//i.test(href)) return;
  if (!/前沿|雷达|趋势|工具|技术|动态/.test(`${block.sectionTitle} ${block.text}`)) return;
  result.radarCandidates.push({
    name: block.text || href, type: null, url: href, source: null,
    decision: null, reviewStatus: "pending",
    evidence: evidence(block, sourceFileId),
  });
}

export function extractByRules(blocks, { sourceFileId }) {
  const result = { periodCandidates: [], departmentCandidates: [], peopleCandidates: [], demandCandidates: [], capabilityCandidates: [], tokenCandidates: [], radarCandidates: [], reportLinks: [], warnings: [] };
  for (const block of blocks) {
    if (block.kind === "link" && block.href) {
      result.reportLinks.push({ url: block.href, evidence: evidence(block, sourceFileId) });
      extractRadarFromLink(block, result, sourceFileId);
    }
    if (block.kind === "list") extractDemandsFromList(block, result, sourceFileId);
    if (block.kind !== "table" || block.rows.length < 2) continue;
    const headers = indexHeaders(block.rows[0]);
    const departmentIndex = column(headers, "部门", "一级部门");
    const activeUsersIndex = column(headers, "活跃人数", "活跃人员", "活跃用户");
    const tokenSourceIndex = column(headers, "来源", "平台");
    const effectiveIndex = column(headers, "有效消耗", "有效token");
    const cacheIndex = column(headers, "缓存读取", "缓存token");
    const typeIndex = column(headers, "类型");
    const nameIndex = column(headers, "名称", "能力名称");
    const runsIndex = column(headers, "运行", "执行次数");
    const demandTitleIndex = column(headers, "需求", "需求名称");
    const demandThemeIndex = column(headers, "主题", "需求主题");
    const subthemeIndex = column(headers, "二级主题", "子主题");
    const requesterIndex = column(headers, "提出人", "申请人", "需求方");
    const frequencyIndex = column(headers, "频次", "次数");
    const demandStatusIndex = column(headers, "需求状态", "进展", "状态");
    const radarNameIndex = column(headers, "项目", "前沿项目", "工具", "名称");
    const radarTypeIndex = column(headers, "类型", "分类");
    const radarDecisionIndex = column(headers, "结论", "建议", "处理方式");
    const radarUrlIndex = column(headers, "链接", "地址", "网址");
    const radarSourceIndex = column(headers, "来源", "出处");
    // 能力表（类型/名称/运行）与雷达表（项目/类型/结论）靠「运行」列区分，避免重复归类
    const isRadarTable = radarNameIndex != null && (radarDecisionIndex != null || radarUrlIndex != null) && runsIndex == null;
    for (const row of block.rows.slice(1)) {
      if (departmentIndex != null && activeUsersIndex != null && row[departmentIndex]) {
        const activeUsers = parseLocalizedNumber(row[activeUsersIndex]);
        if (activeUsers == null) result.warnings.push({ code: "NUMBER_UNRECOGNIZED", blockId: block.id, message: "无法识别活跃人数" });
        else result.departmentCandidates.push({ name: row[departmentIndex], activeUsers, evidence: evidence(block, sourceFileId) });
      }
      if (tokenSourceIndex != null && (effectiveIndex != null || cacheIndex != null) && row[tokenSourceIndex]) {
        result.tokenCandidates.push({ source: row[tokenSourceIndex], input: null, output: null, effective: parseLocalizedNumber(row[effectiveIndex]), cacheRead: parseLocalizedNumber(row[cacheIndex]), classification: "business", evidence: evidence(block, sourceFileId) });
      }
      if (typeIndex != null && nameIndex != null && row[nameIndex]) {
        const type = String(row[typeIndex]).trim().toLowerCase();
        if (["skill", "agent", "automation"].includes(type)) result.capabilityCandidates.push({ type, name: row[nameIndex], runs: parseLocalizedNumber(row[runsIndex]), evidence: evidence(block, sourceFileId) });
      }
      if ((demandTitleIndex != null || demandThemeIndex != null) && (row[demandTitleIndex] || row[demandThemeIndex])) {
        result.demandCandidates.push({
          title: row[demandTitleIndex] || row[demandThemeIndex],
          theme: row[demandThemeIndex] || null,
          subtheme: row[subthemeIndex] || null,
          departmentId: null,
          requester: row[requesterIndex] || null,
          frequency: parseLocalizedNumber(row[frequencyIndex]),
          status: matchAlias(row[demandStatusIndex], DEMAND_STATUS_ALIASES),
          reusable: null,
          evidence: evidence(block, sourceFileId),
        });
      }
      if (isRadarTable && row[radarNameIndex]) {
        result.radarCandidates.push({
          name: row[radarNameIndex],
          type: matchAlias(row[radarTypeIndex], RADAR_TYPE_ALIASES),
          url: row[radarUrlIndex] || null,
          source: row[radarSourceIndex] || null,
          decision: matchAlias(row[radarDecisionIndex], RADAR_DECISION_ALIASES),
          reviewStatus: "pending",
          evidence: evidence(block, sourceFileId),
        });
      }
    }
  }
  return result;
}
