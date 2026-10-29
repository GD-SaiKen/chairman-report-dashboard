import test from "node:test";
import assert from "node:assert/strict";
import { SNAPSHOT_FILES, buildSnapshotFiles, validateSnapshotFiles, slugifyId } from "../js/core/snapshot-contract.js";

const FULL_INPUT = {
  period: { start: "2026-10-27", end: "2026-11-02" },
  departments: [{ id: "quality", name: "品质", activeUsers: 8 }],
  demands: [{ title: "客诉分析", departmentId: "quality", status: "captured", theme: "品质", frequency: 3, reusable: true }],
  capabilities: [{ name: "品质诊断助手", type: "agent", runs: 12 }],
  tokens: [{ source: "Sino WebUI", input: 1200, output: 300, cacheRead: 9000, classification: "business" }],
  radar: [{ name: "MCP", type: "agent-tool", decision: "trial", reviewStatus: "approved", url: "https://example.com" }],
  quality: { status: "ok", warnings: [] },
};

test("produces exactly the seven contracted files", () => {
  const files = buildSnapshotFiles(FULL_INPUT);
  assert.deepEqual(Object.keys(files).sort(), [...SNAPSHOT_FILES].sort());
  assert.equal(validateSnapshotFiles(files).ok, true);
});

test("missing aggregates are null, never zero", () => {
  // 空输入代表「本期完全没有可用证据」，此时所有派生指标都必须是 null
  const files = buildSnapshotFiles({ period: { start: "2026-10-27", end: "2026-11-02" } });
  for (const key of ["activeUsers", "activeDepartments", "newUsers", "repeatUsers", "repeatRate", "validDemands", "activeAgents", "activeSkills"]) {
    assert.equal(files.overview.kpis[key], null, `kpis.${key} 缺失时必须是 null 而不是 0`);
  }
  assert.equal(files.overview.demandFunnel, null);
  assert.equal(files.overview.tokens, null);
  assert.equal(files.overview.capabilities, null);
  assert.equal(files.demands.summary, null);
  assert.equal(files.capabilities.summary, null);
  assert.equal(files.tokens.summary, null);
  assert.equal(validateSnapshotFiles(files).ok, true);
});

test("provided but empty collections stay zero rather than null", () => {
  // 明确给了空数组表示「确实没有」，此时 0 是真实统计结果
  const files = buildSnapshotFiles({
    period: { start: "2026-10-27", end: "2026-11-02" },
    demands: [],
    capabilities: [],
    tokens: [],
    radar: [],
    departments: [],
  });
  assert.equal(files.overview.kpis.validDemands, 0);
  assert.equal(files.overview.demandFunnel.total, 0);
  assert.equal(files.overview.tokens.effective, 0);
});

test("derives per-department and per-platform breakdowns", () => {
  const files = buildSnapshotFiles({
    period: { start: "2026-10-27", end: "2026-11-02" },
    tokens: [
      { source: "Sino WebUI", input: 1200, output: 300, cacheRead: 9000, classification: "business", departmentId: "quality", date: "2026-10-28" },
      { source: "Hermes CLI", input: 100, output: 20, cacheRead: 500, classification: "business", departmentId: "manufacturing", date: "2026-10-29" },
      { source: "aikey gateway", input: 0, output: 0, cacheRead: 0, reconciliationOnly: true, reconciliationTotal: 5_000_000 },
    ],
  });
  // 对账口径单独计量，不进业务量
  assert.equal(files.tokens.summary.effective, 1620);
  assert.equal(files.tokens.summary.reconciliationOnly, 5_000_000);
  assert.equal(files.tokens.byPlatform.length, 3);
  assert.equal(files.tokens.byDepartment.length, 2);
  assert.equal(files.tokens.byDate.length, 2);
  assert.equal(files.tokens.byDepartment.find((item) => item.departmentId === "quality").effective, 1500);
});

test("a token record that only reports effective consumption is still counted", () => {
  // 只给了「有效消耗」而没给 input/output 时，若按 input+output 汇总会把真实消耗算成 0
  const files = buildSnapshotFiles({
    period: { start: "2026-10-27", end: "2026-11-02" },
    tokens: [{ source: "Sino WebUI", effective: 1200, classification: "business" }],
  });
  assert.equal(files.tokens.summary.effective, 1200);
});

test("rejects structural gaps in the snapshot contract", () => {
  const files = buildSnapshotFiles(FULL_INPUT);
  // 明细表必须是数组，null 说明这份数据不是契约产出的
  const nullTable = validateSnapshotFiles({ ...files, tokens: { ...files.tokens, byPlatform: null } });
  assert.equal(nullTable.ok, false);
  assert.ok(nullTable.errors.some((error) => error.includes("tokens.byPlatform must be an array")));

  // 缺键同样必须拦截
  const missingKey = validateSnapshotFiles({ ...files, tokens: { summary: files.tokens.summary, byDepartment: [], byPlatform: [] } });
  assert.equal(missingKey.ok, false);
  assert.ok(missingKey.errors.some((error) => error.includes("tokens.byDate is required")));

  // 缺整个文件也必须拦截
  const missingFile = validateSnapshotFiles({ ...files, radar: undefined });
  assert.equal(missingFile.ok, false);
  assert.ok(missingFile.errors.some((error) => error.includes("radar is required")));
});

test("validators flag NaN and undefined leaking into data", () => {
  const files = buildSnapshotFiles(FULL_INPUT);
  const withNaN = { ...files, overview: { ...files.overview, kpis: { ...files.overview.kpis, activeUsers: Number.NaN } } };
  assert.equal(validateSnapshotFiles(withNaN).ok, false);
  assert.ok(validateSnapshotFiles(withNaN).errors.some((error) => error.includes("activeUsers")));

  const withUndefined = { ...files, departments: { departments: [{ id: "quality", name: "品质", activeUsers: undefined }] } };
  assert.equal(validateSnapshotFiles(withUndefined).ok, false);
  assert.ok(validateSnapshotFiles(withUndefined).errors.some((error) => error.includes("activeUsers must be present")));
});

test("slugifyId produces ids usable by aria-labelledby", () => {
  // 含空格的 id 会被 aria-labelledby 拆成多个 IDREF，读屏就读不出标题
  for (const title of ["AI 普及总览", "Skills & Agents", "部门 AI 采用", "2026 年度", ""]) {
    const id = slugifyId(title);
    assert.equal(/\s/.test(id), false, `id "${id}" 含空白字符`);
    assert.ok(id.length > 0);
  }
  assert.equal(slugifyId("AI 普及总览"), "AI-普及总览");
  assert.equal(slugifyId("Skills & Agents"), "Skills-Agents");
  // 以数字开头的 id 需要加前缀才能安全用作选择器
  assert.equal(slugifyId("2026 年度"), "s-2026-年度");
});
