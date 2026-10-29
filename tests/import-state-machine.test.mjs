import test from "node:test";
import assert from "node:assert/strict";
import { transitionImport } from "../server/import/state-machine.mjs";

test("allows the reviewed happy path", () => {
  assert.equal(transitionImport("uploaded", "sanitizing"), "sanitizing");
  assert.equal(transitionImport("validating", "review_required"), "review_required");
  assert.equal(transitionImport("approved", "publishing"), "publishing");
});

test("does not publish an unapproved draft", () => {
  assert.throws(() => transitionImport("review_required", "publishing"), /invalid transition/);
});

test("processing states may fail", () => {
  assert.equal(transitionImport("extracting", "failed"), "failed");
});

test("a failed publish is recoverable instead of locking the period", () => {
  // 发布失败必须能回到 approved：草稿没变，直接重试即可
  assert.equal(transitionImport("publishing", "approved"), "approved");
  assert.equal(transitionImport("publishing", "failed"), "failed");
  // 从 failed 也能回到待审核或已审核，重新解析或直接重试发布
  assert.equal(transitionImport("failed", "review_required"), "review_required");
  assert.equal(transitionImport("failed", "approved"), "approved");
  assert.equal(transitionImport("failed", "sanitizing"), "sanitizing");
  // 重新解析后仍可再走一遍完整流程
  assert.equal(transitionImport("validating", "review_required"), "review_required");
  assert.equal(transitionImport("review_required", "approved"), "approved");
});

test("a published period is never rolled back by accident", () => {
  assert.throws(() => transitionImport("published", "approved"), /invalid transition/);
  assert.throws(() => transitionImport("published", "sanitizing"), /invalid transition/);
});
