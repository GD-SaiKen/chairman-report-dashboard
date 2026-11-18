#!/usr/bin/env node
/**
 * scripts/init-data.mjs — 生成一份合成示例数据
 *
 * 仓库不再携带任何真实周报数据：data/manifest.json、data/snapshots/、
 * data/curation/ 与 reports/ 都已加入 .gitignore，只在目标机/本地存在。
 * 新克隆的仓库执行 `npm run data:init`，即可得到一份明确标注为示例的期次，
 * 用于打开页面、跑通渲染与发布链路；目标机的真实存档不要被示例覆盖。
 *
 *   npm run data:init            # 仅在 data/manifest.json 不存在时生成
 *   npm run data:init -- --force # 覆盖已有示例
 */

import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SNAPSHOT_FILES, buildSnapshotFiles, validateSnapshotFiles } from "../js/core/snapshot-contract.js";
import { validateManifest } from "../js/core/dashboard-schema.js";

const ROOT = resolve(process.cwd());
const FORCE = process.argv.includes("--force");
const PERIOD_ID = "2026-01-05";
const MANIFEST_PATH = join(ROOT, "data", "manifest.json");

const exists = async (path) => {
  try { await access(path); return true; } catch { return false; }
};

if ((await exists(MANIFEST_PATH)) && !FORCE) {
  console.log("data/manifest.json 已存在，未覆盖。确需重建示例请执行：npm run data:init -- --force");
  process.exit(0);
}

/* 全部为合成指标，不对应任何真实部门或人员 */
const DEMO_INPUT = {
  period: { start: "2026-01-05", end: "2026-01-11" },
  departments: [
    {
      id: "quality", name: "品质", activeUsers: 8, newUsers: 2, repeatUsers: 5, validDemands: 3,
      activeSkills: 4, activeAgents: 1, outputs: 6,
      tokens: { effective: 520000, cacheRead: 1800000, nonBusiness: 40000 },
      topThemes: ["客诉分析", "良率看板"], teams: ["品质工程组"],
    },
    {
      id: "manufacturing", name: "制造", activeUsers: 5, newUsers: 1, repeatUsers: 3, validDemands: 2,
      activeSkills: 2, activeAgents: 2, outputs: 4,
      tokens: { effective: 310000, cacheRead: 900000, nonBusiness: 20000 },
      topThemes: ["工单排产"], teams: ["制造工程组"],
    },
  ],
  demands: [
    {
      id: "d1", date: "2026-01-06", departmentId: "quality", requester: "示例用户",
      title: "客诉与 PLM 溯源", theme: "品质", subtheme: "客诉", frequency: 24,
      status: "delivered", reusable: true, owner: "信息部",
      linkedCapabilityIds: ["c1"], valueTags: ["quality"],
    },
    {
      id: "d2", date: "2026-01-07", departmentId: "manufacturing", requester: "示例用户",
      title: "工单排产看板", theme: "制造", subtheme: "排产", frequency: 18,
      status: "assessed", reusable: true, owner: "信息部",
      linkedCapabilityIds: ["c2"], valueTags: ["manufacturing"],
    },
  ],
  capabilities: [
    {
      id: "c1", name: "品质诊断助手", type: "agent", active: true,
      departmentIds: ["quality"], runs: 12, successes: 11, outputs: 9, linkedDemandIds: ["d1"],
    },
    {
      id: "c2", name: "排产摘要技能", type: "skill", active: true,
      departmentIds: ["manufacturing"], runs: 8, successes: 8, outputs: 6, linkedDemandIds: ["d2"],
    },
  ],
  capabilityRuns: [
    { capabilityId: "c1", date: "2026-01-06", status: "success", deliverableId: "d1", deliveryStatus: "sent" },
    { capabilityId: "c2", date: "2026-01-07", status: "success", deliverableId: "d2", deliveryStatus: "sent" },
  ],
  tokens: [
    { source: "Sino WebUI", input: 1200, output: 300, cacheRead: 9000, classification: "business", departmentId: "quality", date: "2026-01-06" },
    { source: "Cursor", input: 800, output: 200, cacheRead: 4000, classification: "business", departmentId: "manufacturing", date: "2026-01-07" },
    { source: "aikey gateway", input: 5000, output: 0, cacheRead: 0, classification: "business", reconciliationOnly: true, reconciliationTotal: 5000000, date: "2026-01-07" },
  ],
  radar: [
    {
      id: "r1", type: "agent-tool", name: "示例智能体工具", url: "https://example.com",
      source: "示例", stars: 1000, starDelta7d: 12, latestReleaseAt: "2026-01-05",
      maturity: "生产可用", companyFit: "高", applicableDepartments: ["品质"], risks: [],
      decision: "trial", reviewStatus: "approved", summary: "示例条目",
    },
  ],
  report: {
    title: "示例周报", window: "2026-01-05 ~ 01-11",
    localPath: "reports/demo/index.html", onlineUrl: null,
  },
  digest: {
    headline: "示例结论：这条导读由仓库自带的合成数据生成。",
    highlights: ["示例进展一：新的看板完成试用。", "示例进展二：两个技能进入日常运行。", "示例进展三：Token 口径已对账。"],
    watchItems: ["示例待关注一：下周补采失败样本。", "示例待关注二：确认调度超时根因。"],
    reviewer: "示例",
  },
  quality: {
    status: "ok",
    generatedAt: "2026-01-12T00:00:00+08:00",
    sources: [{ id: "demo", status: "ok", asOf: "2026-01-11" }],
    warnings: [],
  },
  radarUpdatedAt: "2026-01-12",
  generatedAt: "2026-01-12T00:00:00+08:00",
};

const files = buildSnapshotFiles(DEMO_INPUT);
const checked = validateSnapshotFiles(files);
if (!checked.ok) throw new Error(`示例快照没有通过契约校验：${checked.errors.join("; ")}`);

const snapshotDir = join(ROOT, "data", "snapshots", "demo");
await mkdir(snapshotDir, { recursive: true });
for (const name of SNAPSHOT_FILES) {
  await writeFile(join(snapshotDir, `${name}.json`), `${JSON.stringify(files[name], null, 2)}\n`, "utf8");
}

const manifest = {
  site: { title: "信息部报告（示例）", subtitle: "本期导读 · 原文阅读 · 专题数据" },
  defaultPeriodId: PERIOD_ID,
  periods: [{
    id: PERIOD_ID,
    label: `${PERIOD_ID} 期（示例）`,
    window: "2026-01-05 ~ 01-11（7天）",
    asOf: "2026-01-11T18:00:00+08:00",
    files: Object.fromEntries(SNAPSHOT_FILES.map((name) => [name, `data/snapshots/demo/${name}.json`])),
  }],
};
const manifestChecked = validateManifest(manifest);
if (!manifestChecked.ok) throw new Error(`示例 manifest 没有通过校验：${manifestChecked.errors.join("; ")}`);
await mkdir(join(ROOT, "data"), { recursive: true });
await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const reportDir = join(ROOT, "reports", "demo");
await mkdir(reportDir, { recursive: true });
await writeFile(join(reportDir, "index.html"), demoReport(), "utf8");

console.log("示例数据已生成：");
console.log("  data/manifest.json");
console.log("  data/snapshots/demo/{overview,departments,demands,capabilities,tokens,radar,quality}.json");
console.log("  reports/demo/index.html");
console.log("下一步：npm start → http://localhost:5175");

function demoReport() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>示例周报</title>
<link rel="stylesheet" href="../../css/report-return.css">
<style>
  body { margin: 0; padding: 48px 24px 96px; background: #f7f8fa; color: #1f2733;
    font: 16px/1.8 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px; background: #fff; border: 1px solid #e3e8f0; border-radius: 8px; }
  h1 { margin-top: 0; font-size: 26px; }
  p { color: #5d6b7d; }
  ol { padding-left: 1.4em; }
</style>
</head>
<body>
<main>
  <h1>示例周报</h1>
  <p>这是仓库自带的合成示例，只用于验证导读、专题页与全文入口，不对应任何真实部门、人员或指标。真实数据由目标机的 <code>data/</code> 与 <code>reports/</code> 保存。</p>
  <h2>本期要点</h2>
  <ol>
    <li>新的看板完成试用，进入周度运营。</li>
    <li>两个技能进入日常运行，产出可追溯。</li>
    <li>Token 双口径已对账，对账量不并入业务量。</li>
  </ol>
  <p>返回导读页可查看合成快照渲染出的关键数字与专题入口。</p>
</main>
<a class="report-return" href="../../index.html" aria-label="返回报告首页">← 返回导读</a>
</body>
</html>
`;
}
