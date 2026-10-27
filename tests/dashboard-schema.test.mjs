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

test("valid records pass", () => {
  assert.equal(validateDepartment({ id: "quality", name: "品质", activeUsers: 2 }).ok, true);
  assert.equal(validateDemand({ id: "d1", departmentId: "quality", title: "良率分析", status: "captured" }).ok, true);
  assert.equal(validateCapability({ id: "s1", name: "quality-report", type: "skill" }).ok, true);
  assert.equal(validateTokenRecord({ id: "t1", classification: "business", input: 1 }).ok, true);
  assert.equal(validateRadarItem({ id: "r1", name: "工具", type: "ai-tool", decision: "watch", reviewStatus: "approved" }).ok, true);
});
