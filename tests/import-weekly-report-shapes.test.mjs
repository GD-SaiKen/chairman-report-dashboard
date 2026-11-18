import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeHtml } from "../server/import/sanitize.mjs";
import { segmentHtml } from "../server/import/segment.mjs";
import { extractByRules } from "../server/import/rule-extractor.mjs";
import { mergeDraft } from "../server/import/merge-draft.mjs";
import { snapshotFromDraft } from "../server/import/publish.mjs";

/*
 * 回归：真实周报的表头形态（11-09 期）必须能端到端抽出内容。
 * 之前规则层只认「活跃人数 / 来源+有效消耗 / 类型+名称+运行」，遇到周报实际写法
 * 全部落空，导入台发布出去的一期七件快照有六件是空的，页面只剩「—」。
 */

async function reportFromFixture() {
  const html = await readFile(new URL("./fixtures/import/weekly-report-shapes.html", import.meta.url), "utf8");
  return extractByRules(segmentHtml(sanitizeHtml(html).document), { sourceFileId: "file-weekly" });
}

test("reads the weekly report's metric band into KPI candidates", async () => {
  const rules = await reportFromFixture();
  const byKey = Object.fromEntries(rules.kpiCandidates.map((item) => [item.key, item.value]));
  assert.equal(byKey.activeUsers, 44);
  assert.equal(byKey.taskUsers, 33);
  assert.equal(byKey.newUsers, 3);
  assert.equal(byKey.runs, 397);
  assert.equal(byKey.successRate, 0.907);
  // 「部门维度 BLOCKED/OK（41 部门）」不是数值，不得猜成 41
  assert.equal(byKey.activeDepartments, undefined);
});

test("keeps department rows, drops the total and unassigned rows", async () => {
  const rules = await reportFromFixture();
  assert.deepEqual(rules.departmentCandidates.map((item) => item.name).sort(), ["品管部", "五金部"].sort());
  const quality = rules.departmentCandidates.find((item) => item.name === "品管部");
  assert.equal(quality.activeUsers, 9);
  assert.equal(quality.runs, 174);
  assert.equal(quality.failures, 22);
});

test("reads capability calls and derives success rate from the failure rate", async () => {
  const rules = await reportFromFixture();
  assert.equal(rules.capabilityCandidates.length, 2);
  const query = rules.capabilityCandidates.find((item) => item.name === "query_objects");
  assert.equal(query.runs, 182);
  assert.equal(query.failures, 24);
  assert.equal(query.successRate, 0.868);
  assert.equal(query.active, true);
});

test("counts each token channel once and never the annotated total row", async () => {
  const rules = await reportFromFixture();
  assert.equal(rules.tokenCandidates.length, 2);
  const total = rules.tokenCandidates.reduce((sum, item) => sum + item.effective, 0);
  // 合计行写的是 2,280.02M：把合计当明细会让总量翻倍
  assert.equal(Math.round(total), Math.round(2280.02e6));
  assert.equal(rules.tokenCandidates[0].input, 1356.2e6);
});

test("splits the requester cell into name plus message count", async () => {
  const rules = await reportFromFixture();
  assert.equal(rules.demandCandidates.length, 1);
  assert.equal(rules.demandCandidates[0].theme, "月报与推送配置");
  assert.equal(rules.demandCandidates[0].requester, "杨高峰");
  assert.equal(rules.demandCandidates[0].frequency, 81);
});

test("publishes the weekly report without the all-dash front page", async () => {
  const rules = await reportFromFixture();
  const merged = mergeDraft({ files: [], ruleResults: [rules], aiResults: [], curation: {}, departmentDictionary: [] });
  const draft = { ...merged, period: { id: "2026-11-09", label: "2026-11-09 期", window: "2026-11-09 ~ 11-15", asOf: "2026-11-15T18:00:00+08:00" } };
  const snapshot = snapshotFromDraft(draft);

  assert.equal(snapshot.overview.kpis.activeUsers, 44);
  assert.equal(snapshot.overview.kpis.activeDepartments, 2);
  assert.equal(snapshot.overview.kpis.newUsers, 3);
  assert.equal(snapshot.overview.kpis.validDemands, 1);
  assert.equal(snapshot.departments.departments.length, 2);
  assert.equal(snapshot.capabilities.capabilities.length, 2);
  assert.equal(snapshot.tokens.byPlatform.length, 2);
  // 源表按 0.01M 取整，累加与「合计」列会差几百个 token，比对放到 0.1M 精度
  assert.ok(Math.abs(snapshot.overview.tokens.effective - 2280.02e6) < 1e5, `effective=${snapshot.overview.tokens.effective}`);
  // 能力表没有 agent/skill 分类：活跃 Agents 必须是未知（页面显示「—」），不能是 0
  assert.equal(snapshot.overview.kpis.activeAgents, null);
  // 报告没给分阶段状态，漏斗不能凭空给 0 项已交付
  assert.equal(snapshot.overview.demandFunnel.counts.delivered, 0);
  assert.equal(snapshot.demands.demands[0].status, null);
});
