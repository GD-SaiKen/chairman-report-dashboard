import test from "node:test";
import assert from "node:assert/strict";
import { snapshotFromDraft, publishDraft } from "../server/import/publish.mjs";

test("builds seven topic payloads from an approved draft", () => {
  const snapshot = snapshotFromDraft({ period: { id: "2026-10-27" }, candidates: { departments: [{ id: "quality" }], radar: [{ id: "x", reviewStatus: "candidate" }] }, summary: {}, quality: { issues: [] } });
  assert.equal(snapshot.departments.departments[0].id, "quality");
  assert.equal(snapshot.radar.items.length, 0);
  assert.equal(Object.keys(snapshot).length, 7);
});

test("refuses publication while blocking issues remain", async () => {
  await assert.rejects(() => publishDraft({ periodId: "2026-10-27", draft: { quality: { issues: [{ severity: "blocking", resolved: false }] } } }), /blocking issues/);
});
