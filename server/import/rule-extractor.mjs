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

export function extractByRules(blocks, { sourceFileId }) {
  const result = { periodCandidates: [], departmentCandidates: [], peopleCandidates: [], demandCandidates: [], capabilityCandidates: [], tokenCandidates: [], radarCandidates: [], reportLinks: [], warnings: [] };
  for (const block of blocks) {
    if (block.kind === "link" && block.href) result.reportLinks.push({ url: block.href, evidence: evidence(block, sourceFileId) });
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
    }
  }
  return result;
}
