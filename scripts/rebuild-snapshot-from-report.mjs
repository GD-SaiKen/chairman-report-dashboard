/**
 * rebuild-snapshot-from-report.mjs — 用已发布的报告全文重建七件快照
 *
 * 场景：导入台的草稿存储不长期保留（/var/lib/chairman-report-import 只存短周期草稿），
 * 但已发布的全文页 reports/<期次>/index.html 会随仓库长期存在。规则层升级后，
 * 需要能就地把历史期次的快照重算一遍，而不是重新上传一遍 HTML。
 *
 * 用法：
 *   node scripts/rebuild-snapshot-from-report.mjs --period 2026-11-09            # 只预览差异
 *   node scripts/rebuild-snapshot-from-report.mjs --period 2026-11-09 --write    # 落盘
 *   node scripts/rebuild-snapshot-from-report.mjs --all [--write]                # 全部期次
 *
 * 约定：解读（digest）、报告全文路径、期次元信息一律沿用已发布值，重建只动七件快照里的
 * 结构化数据；任何一步失败都不写盘。
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sanitizeHtml } from "../server/import/sanitize.mjs";
import { segmentHtml } from "../server/import/segment.mjs";
import { extractByRules } from "../server/import/rule-extractor.mjs";
import { mergeDraft } from "../server/import/merge-draft.mjs";
import { snapshotFromDraft } from "../server/import/publish.mjs";
import { DEPARTMENTS } from "../server/import/pipeline.mjs";
import { SNAPSHOT_FILES, validateSnapshotFiles } from "../js/core/snapshot-contract.js";

const root = resolve(process.cwd());
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag, fallback = "") => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const manifest = await readJson(resolve(root, "data", "manifest.json"));

const targets = has("--all")
  ? manifest.periods.map((period) => period.id)
  : [value("--period")].filter(Boolean);
if (!targets.length) {
  console.error("用法：node scripts/rebuild-snapshot-from-report.mjs --period 2026-11-09 [--write] | --all [--write]");
  process.exit(2);
}

/** 已发布快照的 digest 是扁平字符串，导入台草稿要的是带 reviewStatus 的结构 */
function digestFromOverview(overview) {
  const digest = overview?.digest;
  if (!digest?.headline) return null;
  const wrap = (text, index) => ({ id: `digest-${index}`, text, reviewStatus: "accepted" });
  return {
    headline: { text: digest.headline, reviewStatus: "accepted" },
    highlights: (digest.highlights || []).map(wrap),
    watchItems: (digest.watchItems || []).map(wrap),
    reviewer: digest.reviewer || "信息部",
  };
}

function brief(value) {
  if (value == null) return "null";
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return "{…}";
  return String(value);
}

let failures = 0;
for (const periodId of targets) {
  const entry = manifest.periods.find((period) => period.id === periodId);
  if (!entry) { console.error(`✗ ${periodId}: manifest 里没有这个期次`); failures += 1; continue; }

  const overviewPath = resolve(root, entry.files.overview);
  const versionDir = dirname(overviewPath);
  const current = {};
  for (const name of SNAPSHOT_FILES) current[name] = await readJson(resolve(root, entry.files[name]));

  // 识别「人工整理过的期次」：能力带 skill/agent 分类、部门带新增/复用人数——
  // 这两类信息周报原文里没有，是人工补的，重算只会把数据抽稀，必须显式 --force。
  const typedCapabilities = (current.capabilities?.capabilities || []).filter((item) => item.type);
  const curatedDepartments = (current.departments?.departments || []).filter((item) => item.newUsers != null || item.repeatUsers != null || item.activeSkills != null);
  if ((typedCapabilities.length || curatedDepartments.length) && !has("--force") && !value("--period")) {
    console.log(`\n${periodId}  跳过：含人工整理数据（${typedCapabilities.length} 项带类型能力 / ${curatedDepartments.length} 个带新增复用部门），如确需重算请加 --force`);
    continue;
  }

  const reportRel = current.overview?.report?.localPath;
  if (!reportRel) { console.log(`\n${periodId}  跳过：没有 report.localPath，找不到可复算的全文页`); continue; }
  const reportPath = resolve(root, reportRel);
  const html = await readFile(reportPath, "utf8");

  const blocks = segmentHtml(sanitizeHtml(html).document);
  const ruleResult = extractByRules(blocks, { sourceFileId: "report-html" });
  const curation = await readJson(resolve(root, "data", "curation", `${periodId}.json`)).catch(() => ({}));
  const merged = mergeDraft({ files: [], ruleResults: [ruleResult], aiResults: [], curation, departmentDictionary: DEPARTMENTS });

  const draft = {
    ...merged,
    period: { id: entry.id, label: entry.label, window: entry.window, asOf: entry.asOf, end: null },
    digest: digestFromOverview(current.overview),
  };
  const generatedAt = new Date().toISOString();
  const next = snapshotFromDraft(draft, {
    generatedAt,
    radarUpdatedAt: (merged.candidates.radar || []).length ? generatedAt.slice(0, 10) : null,
    report: current.overview?.report || undefined,
  });

  // 解读是人工审过的内容，重建不碰；其余字段以新抽取为准
  next.overview.digest = current.overview.digest;
  next.overview.report = current.overview.report;
  next.overview.quality = { ...next.overview.quality, sources: current.overview?.quality?.sources || [] };
  next.quality = { ...next.quality, sources: current.quality?.sources || [] };

  const checked = validateSnapshotFiles(next);
  if (!checked.ok) {
    console.error(`✗ ${periodId}: 快照不合契约\n  ${checked.errors.join("\n  ")}`);
    failures += 1;
    continue;
  }

  const changed = SNAPSHOT_FILES.filter((name) => JSON.stringify(current[name]) !== JSON.stringify(next[name]));
  const kpis = next.overview.kpis;
  const filled = Object.entries(kpis).filter(([, item]) => item != null).map(([key]) => key);
  console.log(`\n${periodId}  ${versionDir.split("/").pop()}`);
  console.log(`  KPI 有值: ${filled.join(", ") || "无"}`);
  console.log(`  部门 ${next.departments.departments.length} · 能力 ${next.capabilities.capabilities.length} · 需求 ${next.demands.demands.length} · Token ${next.tokens.byPlatform.length} · 雷达 ${next.radar.items.length}`);
  console.log(`  变化文件: ${changed.join(", ") || "无"}`);
  for (const name of changed) {
    const before = current[name];
    const after = next[name];
    if (name === "overview") {
      const keys = new Set([...Object.keys(before.kpis || {}), ...Object.keys(after.kpis || {})]);
      const diff = [...keys].filter((key) => before.kpis?.[key] !== after.kpis?.[key]).map((key) => `${key}: ${brief(before.kpis?.[key])} → ${brief(after.kpis?.[key])}`);
      console.log(`    overview.kpis → ${diff.join("; ")}`);
    } else {
      console.log(`    ${name}: ${brief(before)} → ${brief(after)}`);
    }
  }
  if (next.overview.quality?.warnings?.length) {
    console.log(`  质量提醒: ${next.overview.quality.warnings.slice(0, 3).join(" / ")}${next.overview.quality.warnings.length > 3 ? " …" : ""}`);
  }

  if (has("--write") && changed.length) {
    for (const name of changed) await writeFile(resolve(versionDir, `${name}.json`), `${JSON.stringify(next[name], null, 2)}\n`, "utf8");
    console.log(`  ✓ 已写入 ${versionDir.replace(`${root}/`, "")}`);
  }
}
process.exitCode = failures ? 1 : 0;
