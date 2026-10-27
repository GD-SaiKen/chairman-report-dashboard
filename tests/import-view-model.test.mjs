import test from "node:test";
import assert from "node:assert/strict";
import { buildSteps, canPublish, groupCandidates } from "../manage/import/views.js";

test("builds review and publication view state", () => {
  assert.equal(buildSteps({ status: "review_required" }).find((step) => step.id === "review").current, true);
  assert.equal(canPublish({ status: "approved", quality: { issues: [] } }), true);
  assert.equal(canPublish({ status: "approved", quality: { issues: [{ severity: "blocking", resolved: false }] } }), false);
  assert.equal(groupCandidates({ candidates: { tokens: [{ id: 1 }, { id: 2 }] } }).tokens.length, 2);
});
