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
