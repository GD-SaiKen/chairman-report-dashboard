export const STEP_DEFS = [
  ["period", "创建期次", ["uploaded"]], ["upload", "上传报告", ["uploaded", "failed"]],
  ["extract", "解析进度", ["sanitizing", "extracting", "validating"]],
  ["review", "提取审核", ["review_required"]], ["publish", "发布确认", ["approved", "publishing", "published"]],
];

export function buildSteps(period = {}) {
  return STEP_DEFS.map(([id, label, states]) => ({ id, label, current: states.includes(period.status) }));
}

export function canPublish(period = {}) {
  return period.status === "approved" && !(period.quality?.issues || []).some((issue) => issue.severity === "blocking" && !issue.resolved);
}

export function groupCandidates(draft = {}) {
  const input = draft.candidates || {};
  return Object.fromEntries(["departments", "people", "demands", "capabilities", "tokens", "radar"].map((key) => [key, input[key] || []]));
}

export function renderWorkbench(root, state) {
  const period = state.period || {};
  const groups = groupCandidates(state.draft);
  root.querySelector("#steps").innerHTML = buildSteps(period).map((step) => `<li class="step ${step.current ? "is-current" : ""}" ${step.current ? 'aria-current="step"' : ""}>${step.label}</li>`).join("");
  root.querySelector("#status").textContent = period.status ? `当前状态：${period.status}` : "尚未创建期次";
  root.querySelector("#candidate-summary").innerHTML = Object.entries(groups).map(([key, items]) => `<article><strong>${key}</strong><span>${items.length}</span></article>`).join("");
  root.querySelector("#issues").innerHTML = (state.quality?.issues || []).map((issue) => `<li><strong>${issue.code}</strong> ${issue.message}</li>`).join("") || "<li>暂无质量问题</li>";
}
