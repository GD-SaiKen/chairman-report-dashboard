export const IMPORT_STATES = [
  "uploaded", "sanitizing", "extracting", "validating",
  "review_required", "approved", "publishing", "published", "failed",
];

const NEXT = {
  uploaded: ["sanitizing", "failed"],
  sanitizing: ["extracting", "failed"],
  extracting: ["validating", "failed"],
  validating: ["review_required", "failed"],
  review_required: ["approved", "sanitizing", "failed"],
  approved: ["publishing", "review_required", "failed"],
  // 发布失败必须能回到 approved：草稿仍是审核通过状态，直接重试即可，
  // 否则一次失败就把期次永久锁死，只能废弃重建
  publishing: ["published", "failed", "approved"],
  failed: ["sanitizing", "review_required", "approved"],
  published: [],
};

export function transitionImport(from, to) {
  if (!IMPORT_STATES.includes(from) || !NEXT[from].includes(to)) {
    throw new Error(`invalid transition: ${from} -> ${to}`);
  }
  return to;
}

export function isProcessing(status) {
  return ["sanitizing", "extracting", "validating", "publishing"].includes(status);
}
