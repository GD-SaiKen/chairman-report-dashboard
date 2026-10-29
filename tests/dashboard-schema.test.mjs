import test from "node:test";
import assert from "node:assert/strict";
import {
  validateManifest,
  validateDepartment,
  validateDemand,
  validateCapability,
  validateTokenRecord,
  validateRadarItem,
} from "../js/core/dashboard-schema.js";

test("manifest requires snapshot files", () => {
  const result = validateManifest({
    defaultPeriodId: "2026-10-12",
    periods: [{ id: "2026-10-12", label: "2026-10-12 期", window: "2026-10-12 ~ 10-17", asOf: "2026-10-21", files: {} }],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /departments/);
});

test("domain validators reject incomplete records", () => {
  assert.equal(validateDepartment({}).ok, false);
  assert.equal(validateDemand({ status: "jumped" }).ok, false);
  assert.equal(validateCapability({ type: "robot" }).ok, false);
  assert.equal(validateTokenRecord({ id: "x", classification: "unknown" }).ok, false);
  assert.equal(validateRadarItem({ id: "x", name: "x", type: "ai-tool", decision: "watch" }).ok, false);
});

test("distinguishes missing keys from explicit nulls", () => {
  // 缺字段必须报出来：undefined 表示上游没给值，与「已知为未知」的 null 是两回事
  const missing = validateDepartment({ id: "quality", name: "品质", activeUsers: 2 });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => error.includes("newUsers must be present")));

  // 显式 null 表示「已知为未知」，应当通过
  const explicit = validateDepartment({ id: "quality", name: "品质", activeUsers: 2, newUsers: null, repeatUsers: null, validDemands: null });
  assert.equal(explicit.ok, true);
});

test("valid records pass", () => {
  assert.equal(validateDepartment({ id: "quality", name: "品质", activeUsers: 2, newUsers: 1, repeatUsers: 1, validDemands: 1 }).ok, true);
  assert.equal(validateDemand({ id: "d1", departmentId: "quality", title: "良率分析", status: "captured" }).ok, true);
  assert.equal(validateCapability({ id: "s1", name: "quality-report", type: "skill" }).ok, true);
  assert.equal(validateTokenRecord({ id: "t1", classification: "business", input: 1 }).ok, true);
  assert.equal(validateRadarItem({ id: "r1", name: "工具", type: "ai-tool", decision: "watch", reviewStatus: "approved" }).ok, true);
});
