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
  approved: ["publishing", "review_required"],
  publishing: ["published", "failed"],
  failed: ["sanitizing"],
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
