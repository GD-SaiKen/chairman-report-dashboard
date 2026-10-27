export const ROUTES = [
  "overview",
  "departments",
  "demands",
  "capabilities",
  "tokens",
  "radar",
];

export const DEMAND_STATES = ["captured", "assessed", "designed", "delivered", "reused", "closed"];
export const CAPABILITY_TYPES = ["skill", "agent", "automation"];
export const TOKEN_CLASSES = ["business", "test", "system"];
export const QUALITY_STATES = ["ok", "warning", "stale", "missing"];
export const RADAR_TYPES = ["ai-tool", "agent-tool", "topic"];
export const RADAR_DECISIONS = ["watch", "trial", "adopt", "reject"];

const RESULT = (errors = []) => ({ ok: errors.length === 0, errors });
const required = (value, name, errors) => {
  if (value == null || value === "") errors.push(`${name} is required`);
};
const oneOf = (value, values, name, errors) => {
  if (value != null && !values.includes(value)) errors.push(`${name} must be one of ${values.join(", ")}`);
};
const object = (value, name, errors) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) errors.push(`${name} must be an object`);
};

export function validateManifest(raw) {
  const errors = [];
  object(raw, "manifest", errors);
  if (!raw) return RESULT(errors);
  required(raw.defaultPeriodId, "defaultPeriodId", errors);
  if (!Array.isArray(raw.periods) || raw.periods.length === 0) errors.push("periods must be a non-empty array");
  for (const period of raw.periods || []) {
    required(period.id, "period.id", errors);
    required(period.label, "period.label", errors);
    required(period.window, "period.window", errors);
    required(period.asOf, "period.asOf", errors);
    const files = period.files || {};
    for (const route of ROUTES.filter((route) => route !== "overview" || true)) {
      if (!files[route] && route !== "overview") errors.push(`period.files.${route} is required`);
    }
    for (const file of ["overview", "departments", "demands", "capabilities", "tokens", "radar", "quality"]) {
      if (!files[file]) errors.push(`period.files.${file} is required`);
    }
  }
  return RESULT(errors);
}

export function validateDepartment(raw) {
  const errors = [];
  object(raw, "department", errors);
  if (!raw) return RESULT(errors);
  required(raw.id, "department.id", errors);
  required(raw.name, "department.name", errors);
  for (const field of ["activeUsers", "newUsers", "repeatUsers", "validDemands"]) {
    if (raw[field] != null && (!Number.isFinite(raw[field]) || raw[field] < 0)) errors.push(`${field} must be a non-negative number or null`);
  }
  return RESULT(errors);
}

export function validateDemand(raw) {
  const errors = [];
  object(raw, "demand", errors);
  if (!raw) return RESULT(errors);
  required(raw.id, "demand.id", errors);
  required(raw.departmentId, "demand.departmentId", errors);
  required(raw.title, "demand.title", errors);
  oneOf(raw.status, DEMAND_STATES, "demand.status", errors);
  return RESULT(errors);
}

export function validateCapability(raw) {
  const errors = [];
  object(raw, "capability", errors);
  if (!raw) return RESULT(errors);
  required(raw.id, "capability.id", errors);
  required(raw.name, "capability.name", errors);
  oneOf(raw.type, CAPABILITY_TYPES, "capability.type", errors);
  return RESULT(errors);
}

export function validateTokenRecord(raw) {
  const errors = [];
  object(raw, "tokenRecord", errors);
  if (!raw) return RESULT(errors);
  required(raw.id, "tokenRecord.id", errors);
  oneOf(raw.classification, TOKEN_CLASSES, "tokenRecord.classification", errors);
  for (const field of ["input", "output", "cacheRead"]) {
    if (raw[field] != null && (!Number.isFinite(raw[field]) || raw[field] < 0)) errors.push(`${field} must be non-negative`);
  }
  return RESULT(errors);
}

export function validateRadarItem(raw) {
  const errors = [];
  object(raw, "radarItem", errors);
  if (!raw) return RESULT(errors);
  required(raw.id, "radarItem.id", errors);
  required(raw.name, "radarItem.name", errors);
  oneOf(raw.type, RADAR_TYPES, "radarItem.type", errors);
  oneOf(raw.decision, RADAR_DECISIONS, "radarItem.decision", errors);
  if (raw.reviewStatus !== "approved") errors.push("radarItem.reviewStatus must be approved for publication");
  return RESULT(errors);
}

export function validateCollection(items, validator, name) {
  const errors = [];
  if (!Array.isArray(items)) return RESULT([`${name} must be an array`]);
  items.forEach((item, index) => {
    const result = validator(item);
    errors.push(...result.errors.map((error) => `${name}[${index}]: ${error}`));
  });
  return RESULT(errors);
}
