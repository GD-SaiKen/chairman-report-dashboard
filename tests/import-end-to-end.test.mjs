import test from "node:test";
import assert from "node:assert/strict";
import { snapshotFromDraft } from "../server/import/publish.mjs";
import { SNAPSHOT_FILES, validateSnapshotFiles } from "../js/core/snapshot-contract.js";
import { draftFromFixture } from "./helpers/extract-fixture.mjs";

test("turns an uploaded HTML report into a reviewable seven-topic snapshot", async () => {
  const { period, draft } = await draftFromFixture();
  assert.equal(period.status, "review_required");
  assert.equal(draft.candidates.departments[0].id, "quality");

  // 抽取必须真的交出需求 / 能力 / Token / 雷达，而不是永远空数组
  assert.equal(draft.candidates.demands.length, 3);
  assert.equal(draft.candidates.capabilities.length, 2);
  assert.equal(draft.candidates.tokens.length, 2);
  assert.equal(draft.candidates.radar.length, 2);

  // 雷达候选一律是待审核，未经审核不得进入正式快照
  for (const item of draft.candidates.radar) assert.equal(item.reviewStatus, "pending");
  assert.equal(snapshotFromDraft(draft).radar.items.length, 0);
});

test("published snapshot carries real content into every topic", async () => {
  const { draft } = await draftFromFixture();
  // 模拟信息部审核通过雷达候选
  draft.candidates.radar = draft.candidates.radar.map((item) => ({ ...item, reviewStatus: "approved" }));

  const snapshot = snapshotFromDraft(draft);
  assert.deepEqual(Object.keys(snapshot).sort(), [...SNAPSHOT_FILES].sort());

  // 总览：KPI 与三个汇总块都必须有值，不能全是「—」
  const kpis = snapshot.overview.kpis;
  assert.equal(kpis.activeDepartments, 2);
  assert.equal(kpis.activeUsers, 12);
  assert.equal(kpis.validDemands, 3);
  assert.equal(snapshot.overview.demandFunnel.total, 3);
  assert.equal(snapshot.overview.capabilities.total, 2);
  assert.equal(snapshot.overview.tokens.effective, 1500);

  // 明细：四个专题都不能是空壳
  assert.equal(snapshot.demands.demands.length, 3);
  assert.equal(snapshot.demands.summary.themes, 2);
  assert.equal(snapshot.capabilities.capabilities.length, 2);
  assert.equal(snapshot.tokens.byPlatform.length, 2);
  assert.equal(snapshot.radar.items.length, 2);
  assert.equal(snapshot.departments.departments.length, 2);

  // 未知项必须是 null，绝不能补 0 冒充已知
  assert.equal(kpis.newUsers, null);
  assert.equal(kpis.repeatUsers, null);
  assert.equal(snapshot.capabilities.summary.active, null);

  assert.equal(validateSnapshotFiles(snapshot).ok, true);
});

test("snapshot from an empty draft stays honest instead of inventing zeros", () => {
  const snapshot = snapshotFromDraft({ period: { id: "2026-10-27" }, candidates: {}, quality: { status: "ok", issues: [] } });
  assert.equal(snapshot.overview.kpis.activeUsers, null);
  assert.equal(snapshot.overview.kpis.validDemands, null);
  assert.equal(snapshot.overview.demandFunnel, null);
  assert.equal(snapshot.overview.tokens, null);
  assert.equal(snapshot.demands.demands.length, 0);
  assert.equal(validateSnapshotFiles(snapshot).ok, true);
});
