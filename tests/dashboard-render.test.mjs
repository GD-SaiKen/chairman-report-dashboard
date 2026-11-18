import test from "node:test";
import assert from "node:assert/strict";
import { installDom, serialize } from "./helpers/dom-stub.mjs";
import { buildSnapshotFiles } from "../js/core/snapshot-contract.js";
import { renderOverview } from "../js/ui/overview.js";
import { renderDepartments } from "../js/ui/departments.js";
import { renderDemands } from "../js/ui/demands.js";
import { renderCapabilities } from "../js/ui/capabilities.js";
import { renderTokens } from "../js/ui/tokens.js";
import { renderRadar } from "../js/ui/radar.js";

/** 模拟导入发布路径：多数派生字段缺失，只有部门活跃人数等少数已知 */
function buildImportSnapshot() {
  const files = buildSnapshotFiles({
    period: { start: "2026-10-27", end: "2026-11-02" },
    departments: [{ id: "quality", name: "品质", activeUsers: 8 }, { id: "manufacturing", name: "制造", activeUsers: 4 }],
    demands: [{ id: "d1", date: "2026-10-28", departmentId: "quality", requester: "查献民", title: "客诉与 PLM 溯源", theme: "品质", subtheme: "客诉", frequency: 24, status: "delivered", reusable: true, owner: "信息部", linkedCapabilityIds: ["c1"], valueTags: ["quality"] }],
    capabilities: [{ id: "c1", name: "品质诊断助手", type: "agent", runs: 12 }],
    tokens: [{ source: "Sino WebUI", input: 1200, output: 300, cacheRead: 9000, classification: "business", departmentId: "quality", date: "2026-10-28" }],
    radar: [{ id: "r1", type: "agent-tool", name: "MCP", url: "https://example.com", source: "GitHub", stars: 1000, starDelta7d: 12, latestReleaseAt: "2026-10-20", maturity: "生产可用", companyFit: "高", applicableDepartments: ["品质"], risks: [], decision: "trial", reviewStatus: "approved", summary: "可接入" }],
    quality: { status: "ok", warnings: [] },
  });
  // 顶栏与总览用的是 manifest 里的期次条目
  return { ...files, period: { id: "2026-10-27", label: "2026-10-27 期", window: "2026-10-27 ~ 11-02" } };
}

/** 模拟上游缺字段的数据：直接删掉这些键，而不是置为 null */
function buildRawSnapshot() {
  const files = buildSnapshotFiles({
    period: { start: "2026-10-27", end: "2026-11-02" },
    departments: [{ id: "quality", name: "品质", activeUsers: 8 }],
    demands: [],
    capabilities: [],
    tokens: [],
    radar: [],
    quality: { status: "ok", warnings: [] },
  });
  for (const department of files.departments.departments) {
    delete department.newUsers;
    delete department.repeatUsers;
    delete department.validDemands;
    delete department.activeSkills;
    delete department.activeAgents;
    delete department.outputs;
  }
  return { ...files, period: { id: "2026-10-27", label: "2026-10-27 期", window: "2026-10-27 ~ 11-02" } };
}

function allIds(node) {
  const found = [];
  const walk = (current) => {
    if (current.nodeType !== 1) return;
    const id = current.getAttribute("id");
    if (id) found.push(id);
    for (const child of current.childNodes) walk(child);
  };
  walk(node);
  return found;
}

function labelledBy(node) {
  const found = [];
  const walk = (current) => {
    if (current.nodeType !== 1) return;
    const value = current.getAttribute("aria-labelledby");
    if (value) found.push(value);
    for (const child of current.childNodes) walk(child);
  };
  walk(node);
  return found;
}

test("renders every topic view without leaking undefined or NaN", () => {
  const uninstall = installDom();
  try {
    const snapshot = buildImportSnapshot();
    const views = {
      overview: renderOverview(snapshot, {}),
      departments: renderDepartments(snapshot, {}),
      demands: renderDemands(snapshot, {}),
      capabilities: renderCapabilities(snapshot, {}),
      tokens: renderTokens(snapshot, {}),
      radar: renderRadar(snapshot, {}),
    };
    for (const [name, node] of Object.entries(views)) {
      const html = serialize(node);
      assert.doesNotMatch(html, /undefined/, `${name} 视图把 undefined 渲染到了页面上`);
      assert.doesNotMatch(html, /NaN/, `${name} 视图把 NaN 渲染到了页面上`);
      assert.doesNotMatch(html, />null</, `${name} 视图把 null 渲染到了页面上`);
    }
  } finally {
    uninstall();
  }
});

test("overview leads with report digest and a prominent same-site full report link", () => {
  const uninstall = installDom();
  try {
    const snapshot = buildImportSnapshot();
    snapshot.overview.report = { title: "信息部周报", window: "本期", localPath: "/reports/current/index.html" };
    snapshot.overview.digest = { headline: "重点结论", highlights: ["已交付异常看板"], watchItems: ["待确认同步状态"] };
    const html = serialize(renderOverview(snapshot));
    assert.ok(html.indexOf("重点结论") < html.indexOf("关键数据"));
    assert.ok(html.includes('href="/reports/current/index.html"'));
    assert.ok(html.includes("已交付异常看板"));
    assert.ok(html.includes("待确认同步状态"));
    // 数字没有语义色：KPI 不应再输出无样式的装饰性修饰类
    assert.doesNotMatch(html, /dash-kpi--/);
    // 条形图数值必须挂到 .dash-bar-value 上，否则右对齐与字重都不生效
    assert.match(html, /<b class="dash-bar-value">/);
  } finally { uninstall(); }
});

test("overview identifies available data sources without presenting reconciliation as usage", () => {
  const uninstall = installDom();
  try {
    const snapshot = buildImportSnapshot();
    snapshot.quality.sources = [{ id: "sino", asOf: "2026-10-17", status: "ok" }, { id: "aikey", status: "warning" }];
    const html = serialize(renderOverview(snapshot));
    assert.match(html, /核对来源：Sino WebUI（2026-10-17）/);
    assert.doesNotMatch(html, /核对来源：[^<]*aikey/);
  } finally { uninstall(); }
});

test("renders departments whose numeric fields are absent from the data", () => {
  const uninstall = installDom();
  try {
    // 历史缺陷：对象里根本没有这些字段时，模板字符串会把 undefined 直接吐到页面上，
    // 而 undefined + undefined 会变成 NaN。契约层会补 null，但渲染层必须自己兜住。
    const html = serialize(renderDepartments(buildRawSnapshot(), {}));
    assert.doesNotMatch(html, /undefined/, "缺字段时不能把 undefined 渲染到页面上");
    assert.doesNotMatch(html, /NaN/, "缺字段时不能把 NaN 渲染到页面上");
    assert.ok(html.includes("<td>—</td>"), "缺字段应统一显示「—」");
  } finally {
    uninstall();
  }
});

test("section ids are whitespace-free and aria-labelledby resolves to a real id", () => {
  const uninstall = installDom();
  try {
    const node = renderOverview(buildImportSnapshot(), {});
    const ids = allIds(node);
    const references = labelledBy(node);

    for (const id of ids) assert.doesNotMatch(id, /\s/, `id "${id}" 含空白，aria-labelledby 会被拆成多个 IDREF`);
    for (const reference of references) {
      // 每个 aria-labelledby 都必须只指向一个真实存在的 id
      assert.equal(reference.includes(" "), false, `aria-labelledby "${reference}" 含空格`);
      assert.ok(ids.includes(reference), `aria-labelledby 指向了不存在的 id：${reference}`);
    }
  } finally {
    uninstall();
  }
});

test("department rows show em dash for unknown numbers and expose the drill-down link", () => {
  const uninstall = installDom();
  try {
    const snapshot = buildImportSnapshot();
    const html = serialize(renderDepartments(snapshot, {}));
    // 导入路径下新增/复用人数未知，必须显示「—」而不是 "undefined / undefined"
    assert.ok(html.includes("<td>—</td>"), "未知的新增/复用人数应显示「—」");
    assert.doesNotMatch(html, /undefined \/ undefined/);
    assert.ok(html.includes('href="#departments?department=quality"'), "部门名必须是下钻入口");

    const withQuery = serialize(renderDepartments(snapshot, { department: "quality" }));
    assert.ok(withQuery.includes("品质 · 部门画像"), "选中部门后应渲染部门画像");
  } finally {
    uninstall();
  }
});
