import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotFromDraft, publishDraft, rollbackRelease, listReleases } from "../server/import/publish.mjs";
import { SNAPSHOT_FILES, validateSnapshotFiles } from "../js/core/snapshot-contract.js";
import { SNAPSHOT_FILE_KEYS } from "../js/core/dashboard-schema.js";
import { draftFromFixture } from "./helpers/extract-fixture.mjs";

function seedManifest() {
  return {
    site: { title: "t", subtitle: "s" },
    defaultPeriodId: "2026-01-01",
    periods: [{
      id: "2026-01-01", label: "既存期", window: "w", asOf: "2026-01-01T00:00:00+08:00",
      files: Object.fromEntries(SNAPSHOT_FILE_KEYS.map((name) => [name, `data/snapshots/2026-01-01/${name}.json`])),
    }],
  };
}

async function makeEnv() {
  const root = await mkdtemp(join(tmpdir(), "crd-publish-"));
  const storageRoot = join(root, ".local-data", "import-storage");
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "data", "manifest.json"), `${JSON.stringify(seedManifest())}\n`, "utf8");
  return { root, storageRoot, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** 走完整抽取链路取草稿；雷达默认待审核，测试里再按需审核 */
async function approvedDraft() {
  const { draft } = await draftFromFixture();
  draft.candidates.radar = draft.candidates.radar.map((item) => ({ ...item, reviewStatus: "approved" }));
  return draft;
}

test("builds seven topic payloads with real content from an approved draft", async () => {
  const snapshot = snapshotFromDraft(await approvedDraft());
  assert.deepEqual(Object.keys(snapshot).sort(), [...SNAPSHOT_FILES].sort());

  // 每个专题都必须有内容，而不只是有七个键
  assert.ok(snapshot.departments.departments.length > 0);
  assert.ok(snapshot.demands.demands.length > 0);
  assert.ok(snapshot.capabilities.capabilities.length > 0);
  assert.ok(snapshot.tokens.byPlatform.length > 0);
  assert.ok(snapshot.radar.items.length > 0);
  assert.ok(snapshot.overview.kpis.activeUsers > 0);
  assert.equal(validateSnapshotFiles(snapshot).ok, true);
});

test("pending radar candidates never reach a published snapshot", async () => {
  const { draft } = await draftFromFixture();
  assert.ok(draft.candidates.radar.length > 0, "抽取结果里应当有雷达候选");
  for (const item of draft.candidates.radar) assert.equal(item.reviewStatus, "pending");
  assert.equal(snapshotFromDraft(draft).radar.items.length, 0);
});

test("refuses publication while blocking issues remain", async () => {
  await assert.rejects(
    () => publishDraft({ periodId: "2026-10-27", draft: { quality: { issues: [{ severity: "blocking", resolved: false }] } } }),
    /blocking issues/,
  );
});

test("publishDraft writes the release and leaves no staging directory behind", async () => {
  const env = await makeEnv();
  try {
    const draft = await approvedDraft();
    const published = await publishDraft({ periodId: "2026-10-27", draft, root: env.root, storageRoot: env.storageRoot, actor: "信息部" });
    assert.ok(published.releaseId);

    // 快照真的落盘了七个文件
    const manifest = JSON.parse(await readFile(join(env.root, "data", "manifest.json"), "utf8"));
    const entry = manifest.periods.find((item) => item.id === "2026-10-27");
    for (const name of SNAPSHOT_FILES) {
      await readFile(join(env.root, entry.files[name]), "utf8");
    }
    // 暂存目录必须清空，不能留下半成品
    const staged = await readdir(join(env.storageRoot, ".publish-tmp")).catch(() => []);
    assert.equal(staged.length, 0);
    assert.equal((await listReleases(env.storageRoot)).length, 1);
  } finally {
    await env.cleanup();
  }
});

test("publishes reviewed digest and sanitized standalone HTML under the same origin", async () => {
  const env = await makeEnv();
  try {
    const draft = await approvedDraft();
    draft.files = [{ fileId: "weekly", title: "信息部周报", reportType: "info-weekly", publishOriginal: true }];
    draft.digestCandidates = { headline: { text: "本期进展", evidence: { sourceFileId: "weekly", blockId: "block-1" } }, highlights: [], watchItems: [] };
    draft.digest = { ...draft.digestCandidates, reviewed: true, reviewer: "信息部" };
    const upload = join(env.storageRoot, "uploads", "2026-10-27", "files");
    await mkdir(upload, { recursive: true });
    await writeFile(join(upload, "weekly.html"), '<!doctype html><html><body><h1 id="top">报告</h1><a href="#top">返回</a><script>alert(1)</script></body></html>');
    await publishDraft({ periodId: "2026-10-27", draft, root: env.root, storageRoot: env.storageRoot, actor: "信息部" });
    const manifest = JSON.parse(await readFile(join(env.root, "data", "manifest.json"), "utf8"));
    const overview = JSON.parse(await readFile(join(env.root, manifest.periods[0].files.overview), "utf8"));
    assert.equal(overview.digest.headline, "本期进展");
    assert.match(overview.report.localPath, /^reports\/2026-10-27-/);
    const html = await readFile(join(env.root, overview.report.localPath), "utf8");
    assert.match(html, /href="#top"/);
    assert.doesNotMatch(html, /<script/);
    assert.match(html, /返回导读/);
  } finally { await env.cleanup(); }
});

test("rejects HTML with missing local assets before publishing", async () => {
  const env = await makeEnv();
  try {
    const draft = await approvedDraft();
    draft.files = [{ fileId: "weekly", title: "信息部周报", reportType: "info-weekly", publishOriginal: true }];
    draft.digest = { headline: { text: "本期进展", evidence: { sourceFileId: "weekly", blockId: "block-1" } }, highlights: [], watchItems: [], reviewed: true, reviewer: "信息部" };
    const upload = join(env.storageRoot, "uploads", "2026-10-27", "files");
    await mkdir(upload, { recursive: true });
    await writeFile(join(upload, "weekly.html"), '<html><head><link rel="stylesheet" href="style.css"></head><body>报告</body></html>');
    await assert.rejects(() => publishDraft({ periodId: "2026-10-27", draft, root: env.root, storageRoot: env.storageRoot, actor: "信息部" }), /本地资源/);
  } finally { await env.cleanup(); }
});

test("backfilling an older period keeps the latest period as the default", async () => {
  const env = await makeEnv();
  try {
    const manifestPath = join(env.root, "data", "manifest.json");
    const seeded = JSON.parse(await readFile(manifestPath, "utf8"));
    seeded.periods.unshift({ id: "2027-01-01", label: "更新期", window: "w", asOf: "2027-01-01T00:00:00+08:00", files: seeded.periods[0].files });
    seeded.defaultPeriodId = "2027-01-01";
    await writeFile(manifestPath, `${JSON.stringify(seeded)}\n`, "utf8");

    const draft = await approvedDraft();
    await publishDraft({ periodId: "2026-10-27", draft, root: env.root, storageRoot: env.storageRoot, actor: "信息部" });

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.defaultPeriodId, "2027-01-01", "回填旧期不应把首页默认期次改回旧期");
    assert.deepEqual(manifest.periods.map((period) => period.id), ["2027-01-01", "2026-10-27", "2026-01-01"]);
  } finally { await env.cleanup(); }
});

test("a failed publish leaves no staged snapshot or partial manifest behind", async () => {
  const env = await makeEnv();
  try {
    const draft = await approvedDraft();
    // 期次缺 label/window/asOf，清单校验会在落盘阶段失败
    draft.period = { id: "2026-10-27" };
    await assert.rejects(
      () => publishDraft({ periodId: "2026-10-27", draft, root: env.root, storageRoot: env.storageRoot, actor: "信息部" }),
      /manifest invalid/,
    );

    const manifest = JSON.parse(await readFile(join(env.root, "data", "manifest.json"), "utf8"));
    // 发布失败必须保住原有清单，绝不留下半份
    assert.equal(manifest.defaultPeriodId, "2026-01-01");
    assert.equal(manifest.periods.length, 1);
    assert.equal((await listReleases(env.storageRoot)).length, 0);

    // 暂存目录必须被清掉，不能在项目里留下半成品
    const staged = await readdir(join(env.storageRoot, ".publish-tmp")).catch(() => []);
    assert.equal(staged.length, 0, "暂存目录残留了半成品");
  } finally {
    await env.cleanup();
  }
});

test("rollbackRelease reports a missing release instead of crashing", async () => {
  const env = await makeEnv();
  try {
    let error;
    try {
      await rollbackRelease({ releaseId: "missing-release", root: env.root, storageRoot: env.storageRoot, actor: "信息部" });
    } catch (thrown) {
      error = thrown;
    }
    assert.ok(error, "不存在的版本必须报错");
    assert.match(error.message, /release not found/);
  } finally {
    await env.cleanup();
  }
});

test("listReleases skips directories without a release record", async () => {
  const env = await makeEnv();
  try {
    const draft = await approvedDraft();
    await publishDraft({ periodId: "2026-10-27", draft, root: env.root, storageRoot: env.storageRoot, actor: "信息部" });
    // 混入一个没有 release.json 的目录，不能让整个列表 500
    await mkdir(join(env.storageRoot, "releases", "broken-dir"), { recursive: true });
    const releases = await listReleases(env.storageRoot);
    assert.equal(releases.length, 1);
    assert.equal(releases[0].periodId, "2026-10-27");
  } finally {
    await env.cleanup();
  }
});
