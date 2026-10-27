export function mergeDraft({ files = [], ruleResults = [], aiResults = [], curation = {}, departmentDictionary = [] }) {
  const issues = [];
  const departments = [];
  const byName = new Map();
  const known = new Map(departmentDictionary.map((item) => [item.name, item]));
  const tokens = { effective: 0, cacheRead: 0, nonBusiness: 0, reconciliationOnly: 0 };
  const sources = [...ruleResults, ...aiResults];
  for (const source of sources) {
    for (const item of source.departmentCandidates || source.departments || []) {
      const department = known.get(item.name);
      if (!department) {
        issues.push({ id: `unknown-${item.name}`, code: "UNKNOWN_DEPARTMENT", severity: "blocking", message: `未识别一级部门：${item.name}`, resolved: false });
        continue;
      }
      const prior = byName.get(department.id);
      if (prior && prior.activeUsers !== item.activeUsers) issues.push({ id: `conflict-${department.id}`, code: "SOURCE_CONFLICT", severity: "blocking", message: `${department.name} 活跃人数存在不同来源值`, resolved: false });
      else if (!prior) { const value = { ...department, activeUsers: item.activeUsers }; byName.set(department.id, value); departments.push(value); }
    }
    for (const item of source.tokenCandidates || source.tokens || []) {
      const effective = Number(item.effective || 0);
      const cacheRead = Number(item.cacheRead || 0);
      if (/aikey/i.test(item.source || "") || item.reconciliationOnly) tokens.reconciliationOnly += effective;
      else if (["test", "system"].includes(item.classification)) tokens.nonBusiness += effective;
      else tokens.effective += effective;
      tokens.cacheRead += cacheRead;
    }
  }
  return {
    files,
    candidates: { departments, demands: [], capabilities: [], tokens: [] },
    summary: { tokens },
    quality: { status: issues.length ? "warning" : "ok", issues },
    revisions: [],
    curation,
  };
}

export function canApproveDraft(draft) {
  return !(draft.quality?.issues || []).some((issue) => issue.severity === "blocking" && !issue.resolved);
}
