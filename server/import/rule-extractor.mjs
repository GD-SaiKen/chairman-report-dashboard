import { classifyTable, parseQuantity, parseRate, metricKey, isSummaryRow, cleanDepartmentName, isUnassigned } from "./table-classifier.mjs";

/** 兼容旧调用：整数/千分位/KMG 后缀，识别不出返回 null（绝不返回 0） */
export function parseLocalizedNumber(value) {
  return parseQuantity(value, 1);
}

export function parsePercent(value) {
  return parseRate(value);
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

/* ------------------------- 按表语义抽取（新） ------------------------- */

const RATE_KEYS = new Set(["successRate"]);

function cellAt(row, role) {
  return role ? row[role.index] : undefined;
}

/**
 * 规模指标带：指标 | 上期 | 本期 | 变化。
 * 一张表至少认出 2 个 KPI 才采信——只有 1 个的多半是「定时任务成功率」这类局部指标，
 * 采信它会把局部口径冒充成业务口径。多张表按识别数排序，先到先得。
 */
function extractKpis(tables, result, sourceFileId) {
  const scored = tables
    .filter((table) => table.kind === "scale")
    .map((table) => {
      const metrics = [];
      for (const row of table.block.rows.slice(1)) {
        const name = cellAt(row, table.roles.metric);
        const key = metricKey(name);
        if (!key) continue;
        const cell = cellAt(row, table.roles.current);
        const unit = table.roles.metric.unit !== 1 ? table.roles.metric.unit : table.roles.current.unit ?? 1;
        const value = RATE_KEYS.has(key) ? parseRate(cell) : parseQuantity(cell, unit);
        if (value == null) continue;
        if (!metrics.some((item) => item.key === key)) metrics.push({ key, value, name });
      }
      // 有「上期/上周」列说明是周环比表，比单期快照可信
      return { table: table.block, metrics, score: metrics.length * 10 + (table.roles.previous ? 3 : 0) };
    })
    .filter((item) => item.metrics.length >= 2)
    .sort((a, b) => b.score - a.score);

  const seen = new Set();
  for (const item of scored) {
    for (const metric of item.metrics) {
      if (seen.has(metric.key)) continue;
      seen.add(metric.key);
      result.kpiCandidates.push({ key: metric.key, value: metric.value, label: metric.name, evidence: evidence(item.table, sourceFileId) });
    }
  }

  // 报告没直说活跃人员时，用「用户 × 有效条数」榜单的行数推算——这正是驾驶舱对
  // 「产生有效业务需求的人」的定义。属推算值，落一条提醒让读者知道来源。
  if (!seen.has("activeUsers")) {
    const best = tables
      .filter((table) => table.kind === "people" && table.roles.demands)
      .sort((a, b) => b.block.rows.length - a.block.rows.length)[0];
    if (best) {
      const rows = best.block.rows.slice(1).filter((row) => !isSummaryRow(row) && String(cellAt(row, best.roles.user) ?? "").trim());
      if (rows.length >= 3) {
        result.kpiCandidates.push({ key: "activeUsers", value: rows.length, label: `用户榜单 ${rows.length} 行`, derived: true, evidence: evidence(best.block, sourceFileId) });
        result.warnings.push({ code: "ACTIVE_USERS_DERIVED", blockId: best.block.id, message: `活跃人员未直接给出，按用户榜单 ${rows.length} 行推算` });
      }
    }
  }
}

/** 部门汇总表：同一批部门可能被拆在多张表（需求榜 / 使用榜），按部门名合并 */
function extractDepartments(tables, result, sourceFileId) {
  const merged = new Map();
  for (const table of tables.filter((item) => item.kind === "departments")) {
    for (const row of table.block.rows.slice(1)) {
      const name = cleanDepartmentName(cellAt(row, table.roles.department));
      if (!name || isSummaryRow(row) || isUnassigned(name)) continue;
      const entry = merged.get(name) || { name, activeUsers: null, runs: null, failures: null, validDemands: null, share: null, block: table.block };
      const users = table.roles.people ? parseQuantity(cellAt(row, table.roles.people), table.roles.people.unit ?? 1) : null;
      const runs = table.roles.runs ? parseQuantity(cellAt(row, table.roles.runs), table.roles.runs.unit ?? 1) : null;
      const failures = table.roles.failures ? parseQuantity(cellAt(row, table.roles.failures), 1) : null;
      const demands = table.roles.demands ? parseQuantity(cellAt(row, table.roles.demands), 1) : null;
      const share = table.roles.share ? parseRate(cellAt(row, table.roles.share)) : null;
      if (users != null) entry.activeUsers = users;
      if (runs != null) entry.runs = runs;
      if (failures != null) entry.failures = failures;
      if (demands != null) entry.validDemands = demands;
      if (share != null) entry.share = share;
      merged.set(name, entry);
    }
  }
  for (const entry of merged.values()) {
    if (entry.activeUsers == null && entry.runs == null && entry.validDemands == null) continue;
    result.departmentCandidates.push({
      name: entry.name,
      activeUsers: entry.activeUsers,
      runs: entry.runs,
      failures: entry.failures,
      validDemands: entry.validDemands,
      share: entry.share,
      evidence: evidence(entry.block, sourceFileId),
    });
  }
}

/** 能力表：能力 | 业务调用 | 真失败 | 真失败率 —— 有调用即视为活跃 */
function extractCapabilities(tables, result, sourceFileId) {
  for (const table of tables.filter((item) => item.kind === "capabilities")) {
    for (const row of table.block.rows.slice(1)) {
      const name = String(cellAt(row, table.roles.capability) ?? "").trim();
      if (!name || isSummaryRow(row)) continue;
      const runs = table.roles.runs ? parseQuantity(cellAt(row, table.roles.runs), table.roles.runs.unit ?? 1) : null;
      const failures = table.roles.failures ? parseQuantity(cellAt(row, table.roles.failures), 1) : null;
      const failRate = table.roles.failRate ? parseRate(cellAt(row, table.roles.failRate)) : null;
      result.capabilityCandidates.push({
        type: null,
        name,
        runs,
        failures,
        successes: runs != null && failures != null ? runs - failures : null,
        successRate: failRate == null ? null : Number((1 - failRate).toFixed(4)),
        active: runs == null ? null : runs > 0,
        evidence: evidence(table.block, sourceFileId),
      });
    }
  }
}

/**
 * Token 表：通道 | 请求 | 输入(M) | 输出(M) | 合计(M)。
 * 同一个报告里常有多张拆分口径的表（按项目、按模型、按日期），同时入库会把同一笔消耗
 * 重复计入总量，所以只取信息最完整的一张。
 */
function extractTokens(tables, result, sourceFileId) {
  const scored = tables
    .filter((item) => item.kind === "tokens")
    .map((table) => {
      // 同分时取数据行更多的表：按模型/项目的全量拆分通常比局部拆分完整
      const score = (table.roles.total ? 3 : 0) + (table.roles.requests ? 2 : 0)
        + (table.roles.input && table.roles.output ? 2 : 0) + (table.roles.channel.header === "通道" ? 1 : 0)
        + Math.min(table.block.rows.length, 60) / 100;
      return { table, score };
    })
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return;
  const table = scored[0].table;
  for (const row of table.block.rows.slice(1)) {
    const source = String(cellAt(row, table.roles.channel) ?? "").trim();
    if (!source || isSummaryRow(row) || isUnassigned(source)) continue;
    const input = table.roles.input ? parseQuantity(cellAt(row, table.roles.input), table.roles.input.unit ?? 1) : null;
    const output = table.roles.output ? parseQuantity(cellAt(row, table.roles.output), table.roles.output.unit ?? 1) : null;
    const total = table.roles.total ? parseQuantity(cellAt(row, table.roles.total), table.roles.total.unit ?? 1) : null;
    // 「有效消耗」是报告直接给出的口径；没有它才用合计/输入+输出推算
    const declared = table.roles.effective ? parseQuantity(cellAt(row, table.roles.effective), table.roles.effective.unit ?? 1) : null;
    const effective = declared ?? total ?? (input != null || output != null ? (input ?? 0) + (output ?? 0) : null);
    const cacheRead = table.roles.cache ? parseQuantity(cellAt(row, table.roles.cache), table.roles.cache.unit ?? 1) : null;
    const requests = table.roles.requests ? parseQuantity(cellAt(row, table.roles.requests), 1) : null;
    if (effective == null && cacheRead == null) continue;
    result.tokenCandidates.push({
      source,
      input,
      output,
      effective,
      cacheRead,
      requests,
      classification: "business",
      evidence: evidence(table.block, sourceFileId),
    });
  }
}

/** 需求主题表：主题 | 提出人（条数） | 本期要点 | 状态 */
function extractDemands(tables, result, sourceFileId) {
  for (const table of tables.filter((item) => item.kind === "demands")) {
    for (const row of table.block.rows.slice(1)) {
      const theme = String(cellAt(row, table.roles.theme) ?? "").trim();
      if (!theme || isSummaryRow(row)) continue;
      const requesterCell = String(cellAt(row, table.roles.requester) ?? "").trim();
      const matched = requesterCell.match(/^(.+?)\s*[（(]\s*(\d+)\s*[)）]$/);
      const statusText = String(cellAt(row, table.roles.status) ?? "");
      result.demandCandidates.push({
        title: theme,
        theme,
        subtheme: null,
        departmentId: null,
        requester: matched ? matched[1].trim() : requesterCell || null,
        frequency: matched ? Number(matched[2]) : table.roles.demands ? parseQuantity(cellAt(row, table.roles.demands), 1) : null,
        status: matchAlias(statusText, DEMAND_STATUS_ALIASES),
        statusText: statusText || null,
        reusable: null,
        evidence: evidence(table.block, sourceFileId),
      });
    }
  }
}

/** 雷达候选表：项目/工具 | 类型 | 结论 | 链接 */
function extractRadarTables(tables, result, sourceFileId) {
  for (const table of tables.filter((item) => item.kind === "radar")) {
    for (const row of table.block.rows.slice(1)) {
      const name = String(cellAt(row, table.roles.name) ?? cellAt(row, table.roles.channel) ?? "").trim();
      if (!name || isSummaryRow(row)) continue;
      result.radarCandidates.push({
        name,
        type: matchAlias(cellAt(row, table.roles.type), RADAR_TYPE_ALIASES),
        url: cellAt(row, table.roles.url) || null,
        source: cellAt(row, table.roles.source) || null,
        decision: matchAlias(cellAt(row, table.roles.status), RADAR_DECISION_ALIASES),
        reviewStatus: "pending",
        evidence: evidence(table.block, sourceFileId),
      });
    }
  }
}

/* --------------------- 旧表头兜底（未通过语义识别） --------------------- */

/**
 * 语义识别不了的表格走这里：仅覆盖项目自 v2 早期的三种固定表头
 * （部门+活跃人数、来源+有效消耗/缓存读取、类型+名称+运行）。
 * 目的是不让老报告与老测试失效，不承担新体例的抽取。
 */
function extractLegacyTable(block, result, sourceFileId) {
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

export function extractByRules(blocks, { sourceFileId }) {
  const result = {
    periodCandidates: [], departmentCandidates: [], peopleCandidates: [], demandCandidates: [],
    capabilityCandidates: [], tokenCandidates: [], radarCandidates: [], reportLinks: [],
    kpiCandidates: [], warnings: [],
  };
  const tables = [];
  for (const block of blocks) {
    if (block.kind === "link" && block.href) {
      result.reportLinks.push({ url: block.href, evidence: evidence(block, sourceFileId) });
      extractRadarFromLink(block, result, sourceFileId);
    }
    if (block.kind === "list") extractDemandsFromList(block, result, sourceFileId);
    if (block.kind !== "table" || block.rows.length < 2) continue;
    const classified = classifyTable(block.rows);
    if (!classified.kind) { extractLegacyTable(block, result, sourceFileId); continue; }
    tables.push({ block, ...classified });
  }
  extractKpis(tables, result, sourceFileId);
  extractDepartments(tables, result, sourceFileId);
  extractCapabilities(tables, result, sourceFileId);
  extractTokens(tables, result, sourceFileId);
  extractDemands(tables, result, sourceFileId);
  extractRadarTables(tables, result, sourceFileId);
  return result;
}
