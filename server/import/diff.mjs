function mapById(items = []) { return new Map(items.map((item) => [item.id, item])); }
function stable(value) { return JSON.stringify(value, Object.keys(value || {}).sort()); }

export function diffEntities(entity, previous = [], next = []) {
  const before = mapById(previous), after = mapById(next), added = [], removed = [], changed = [];
  for (const [id, value] of after) {
    if (!before.has(id)) added.push({ entity, id });
    else if (stable(before.get(id)) !== stable(value)) changed.push({ entity, id, from: before.get(id), to: value });
  }
  for (const id of before.keys()) if (!after.has(id)) removed.push({ entity, id });
  return { added, changed, removed };
}

export function diffSnapshots(previous = {}, next = {}) {
  // 期次首次发布时调用方传入 null（该期次尚无已发布快照）；默认参数只兜 undefined，此处显式归一。
  // 否则 previous.departments 会抛 TypeError，管理台的「发布确认」步骤直接 500。
  previous = previous || {};
  next = next || {};
  const groups = [["department", previous.departments?.departments, next.departments?.departments], ["demand", previous.demands?.demands, next.demands?.demands], ["capability", previous.capabilities?.capabilities, next.capabilities?.capabilities], ["radar", previous.radar?.items, next.radar?.items]];
  const result = { added: [], changed: [], removed: [], qualityChanges: [] };
  for (const [entity, before, after] of groups) { const diff = diffEntities(entity, before, after); result.added.push(...diff.added); result.changed.push(...diff.changed); result.removed.push(...diff.removed); }
  const beforeIssues = new Set((previous.quality?.issues || previous.quality?.warnings || []).map((item) => item.code || item));
  const afterIssues = new Set((next.quality?.issues || next.quality?.warnings || []).map((item) => item.code || item));
  for (const code of new Set([...beforeIssues, ...afterIssues])) if (beforeIssues.has(code) !== afterIssues.has(code)) result.qualityChanges.push({ code, from: beforeIssues.has(code) ? "open" : "absent", to: afterIssues.has(code) ? "open" : "resolved" });
  return result;
}
