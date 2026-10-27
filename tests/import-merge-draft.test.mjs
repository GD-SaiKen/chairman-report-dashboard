import test from "node:test";
import assert from "node:assert/strict";
import { mergeDraft, canApproveDraft } from "../server/import/merge-draft.mjs";

test("does not add aikey reconciliation to effective tokens", () => {
  const draft = mergeDraft({ files: [], ruleResults: [{ tokenCandidates: [{ source: "Sino WebUI", effective: 1200, cacheRead: 5000 }, { source: "aikey gateway", effective: 9000, cacheRead: 0 }] }], aiResults: [], curation: {}, departmentDictionary: [] });
  assert.equal(draft.summary.tokens.effective, 1200);
  assert.equal(draft.summary.tokens.reconciliationOnly, 9000);
});

test("blocks unknown departments and source conflicts", () => {
  const draft = mergeDraft({ files: [], ruleResults: [{ departmentCandidates: [{ name: "未知部", activeUsers: 2 }] }, { departmentCandidates: [{ name: "品质", activeUsers: 8 }, { name: "品质", activeUsers: 9 }] }], aiResults: [], curation: {}, departmentDictionary: [{ id: "quality", name: "品质" }] });
  assert.equal(draft.quality.issues.some((item) => item.code === "UNKNOWN_DEPARTMENT" && item.severity === "blocking"), true);
  assert.equal(draft.quality.issues.some((item) => item.code === "SOURCE_CONFLICT"), true);
  assert.equal(canApproveDraft(draft), false);
});
