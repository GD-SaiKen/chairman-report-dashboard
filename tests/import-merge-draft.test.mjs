import test from "node:test";
import assert from "node:assert/strict";
import { mergeDraft, canApproveDraft } from "../server/import/merge-draft.mjs";
import { snapshotFromDraft } from "../server/import/publish.mjs";

test("does not add aikey reconciliation to effective tokens", () => {
  const ruleResults = [{ tokenCandidates: [{ source: "Sino WebUI", effective: 1200, cacheRead: 5000 }, { source: "aikey gateway", effective: 9000, cacheRead: 0 }] }];
  const draft = mergeDraft({ files: [], ruleResults, aiResults: [], curation: {}, departmentDictionary: [] });

  // 合并阶段：aikey 记录必须被标记成对账口径，且仍然保留在候选里
  const aikey = draft.candidates.tokens.find((item) => item.source === "aikey gateway");
  assert.equal(aikey.reconciliationOnly, true);

  // 产出阶段：对账量只能进 reconciliationOnly，不得进业务总量
  const snapshot = snapshotFromDraft(draft);
  assert.equal(snapshot.tokens.summary.effective, 1200);
  assert.equal(snapshot.tokens.summary.reconciliationOnly, 9000);
  assert.equal(snapshot.overview.tokens.effective, 1200);
  assert.equal(snapshot.tokens.byPlatform.find((item) => item.name === "aikey gateway").reconciliationOnly, true);
});

test("keeps unmapped departments under their report name and blocks only source conflicts", () => {
  const draft = mergeDraft({ files: [], ruleResults: [{ departmentCandidates: [{ name: "未知部", activeUsers: 2 }] }, { departmentCandidates: [{ name: "品质", activeUsers: 8 }, { name: "品质", activeUsers: 9 }] }], aiResults: [], curation: {}, departmentDictionary: [{ id: "quality", name: "品质" }] });
  // 周报的部门粒度比驾驶舱一级部门细（车间 / 电脑室 / 财务部）：未映射按原名保留并提醒，
  // 不再阻断发布——阻断会让整期发布不了，正是页面长期只剩「—」的原因
  assert.equal(draft.quality.issues.some((item) => item.code === "UNMAPPED_DEPARTMENT" && item.severity === "info"), true);
  assert.equal(draft.quality.issues.some((item) => item.code === "UNKNOWN_DEPARTMENT"), false);
  assert.equal(draft.candidates.departments.some((item) => item.name === "未知部"), true);
  // 同一部门两个不同数值仍然是阻断问题，不能悄悄取一个
  assert.equal(draft.quality.issues.some((item) => item.code === "SOURCE_CONFLICT"), true);
  assert.equal(canApproveDraft(draft), false);
});
