import test from "node:test";
import assert from "node:assert/strict";
import records from "./fixtures/activity-records.json" with { type: "json" };
import { summarizeAdoption, summarizeDemandFunnel, summarizeCapabilities, summarizeTokens } from "../js/core/metrics.js";

test("repeat user requires two dates or two sessions", () => {
  const result = summarizeAdoption(records, { start: "2026-10-12", end: "2026-10-17" });
  assert.equal(result.activeUsers, 3);
  assert.equal(result.newUsers, 2);
  assert.equal(result.repeatUsers, 2);
  assert.equal(result.activeDepartments, 2);
});

test("aikey reconciliation totals are not added to canonical business totals", () => {
  const result = summarizeTokens([
    { id: "a", source: "sino", classification: "business", input: 1000, output: 200, cacheRead: 5000 },
    { id: "b", source: "aikey", classification: "business", input: 8000, output: 1000, cacheRead: 0, reconciliationOnly: true },
    { id: "c", source: "sino", classification: "test", input: 100, output: 50, cacheRead: 0 },
  ]);
  assert.equal(result.effective, 1200);
  assert.equal(result.cacheRead, 5000);
  assert.equal(result.reconciliationOnly, 9000);
  assert.equal(result.nonBusiness, 150);
});

test("funnel and capability output use explicit evidence", () => {
  const funnel = summarizeDemandFunnel([
    { status: "captured", reusable: true }, { status: "delivered", reusable: true }, { status: "closed", reusable: false },
  ]);
  assert.deepEqual(funnel.counts, { captured: 1, assessed: 0, designed: 0, delivered: 1, reused: 0, closed: 1 });
  const capabilities = summarizeCapabilities([{ type: "agent", active: true }], [
    { status: "success", deliverableId: "file-1" }, { status: "success" }, { status: "failure" },
  ]);
  assert.equal(capabilities.outputs, 1);
  assert.equal(capabilities.successRate, 2 / 3);
});
