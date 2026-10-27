import test from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractPeriod } from "../server/import/pipeline.mjs";
import { snapshotFromDraft } from "../server/import/publish.mjs";

test("turns an uploaded HTML report into a reviewable seven-topic snapshot", async () => {
  const fixtureDir = dirname(fileURLToPath(new URL("./fixtures/import/structured-report.html", import.meta.url)));
  let period = { id: "2026-10-27", label: "2026-10-27 期", window: "2026-10-27 ~ 11-02", asOf: "2026-11-02T18:00:00+08:00", status: "uploaded", files: [{ fileId: "structured-report", title: "测试周报" }] };
  let draft, quality;
  const store = {
    uploadDir: () => fixtureDir,
    getPeriod: async () => period,
    savePeriod: async (_id, value) => { period = value; },
    saveDraft: async (_id, value) => { draft = value; },
    saveQuality: async (_id, value) => { quality = value; },
    appendAudit: async () => {},
  };
  await extractPeriod(period.id, { store });
  const snapshot = snapshotFromDraft(draft);
  assert.equal(period.status, "review_required");
  assert.equal(draft.candidates.departments[0].id, "quality");
  assert.equal(quality.status, "ok");
  assert.equal(Object.keys(snapshot).length, 7);
});
