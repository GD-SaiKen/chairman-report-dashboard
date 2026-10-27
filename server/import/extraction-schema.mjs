const TYPES = ["departments", "people", "demands", "capabilities", "tokens", "radar", "warnings"];

export function validateExtractionResult(value, blockIds = new Set()) {
  const errors = [];
  if (!value || typeof value !== "object") return { ok: false, errors: ["result must be an object"] };
  for (const type of TYPES) if (!Array.isArray(value[type])) errors.push(`${type} must be an array`);
  for (const demand of value.demands || []) {
    if (!demand.title) errors.push("demand.title is required");
    if (!["captured", "assessed"].includes(demand.status)) errors.push("AI demand status must be captured or assessed");
    if (!blockIds.has(demand.evidence?.blockId)) errors.push("demand evidence must reference a supplied block");
  }
  for (const item of value.radar || []) if (item.reviewStatus !== "candidate") errors.push("AI radar reviewStatus must be candidate");
  return { ok: errors.length === 0, errors };
}
