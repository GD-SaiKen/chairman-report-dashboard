import test from "node:test";
import assert from "node:assert/strict";
import { loadSnapshot } from "../js/core/dashboard-data.js";
import { SNAPSHOT_FILES, buildSnapshotFiles } from "../js/core/snapshot-contract.js";
import { SNAPSHOT_FILE_KEYS } from "../js/core/dashboard-schema.js";

const PERIOD_ID = "2026-10-27";

function makeManifest() {
  return {
    site: { title: "t", subtitle: "s" },
    defaultPeriodId: PERIOD_ID,
    periods: [{
      id: PERIOD_ID, label: "2026-10-27 期", window: "2026-10-27 ~ 11-02", asOf: "2026-11-02T18:00:00+08:00",
      files: Object.fromEntries(SNAPSHOT_FILE_KEYS.map((name) => [name, `data/snapshots/${PERIOD_ID}/${name}.json`])),
    }],
  };
}

const GOOD_FILES = buildSnapshotFiles({
  period: { start: PERIOD_ID, end: "2026-11-02" },
  departments: [{ id: "quality", name: "品质", activeUsers: 8, newUsers: 2, repeatUsers: 6, validDemands: 3, activeSkills: 5, activeAgents: 2, outputs: 4 }],
  demands: [],
  capabilities: [],
  tokens: [],
  radar: [],
  quality: { status: "ok", warnings: [] },
});

/** 按路径返回内容；missing 里的路径一律 404 */
function withFetch(missing = []) {
  globalThis.fetch = async (url) => {
    const name = SNAPSHOT_FILES.find((file) => url.endsWith(`/${file}.json`));
    if (missing.includes(name)) return { ok: false, status: 404, json: async () => { throw new Error("no json"); } };
    return { ok: true, json: async () => GOOD_FILES[name] };
  };
}

test("loads a complete snapshot without complaint", async () => {
  withFetch();
  const snapshot = await loadSnapshot(makeManifest(), PERIOD_ID);
  assert.equal(snapshot.quality.status, "ok");
  assert.equal(snapshot.quality.warnings.length, 0);
});

test("surfaces missing topic files instead of rendering them as empty", async () => {
  // 历史缺陷：文件加载失败时只塞个占位对象，质量标记仍显示「数据正常」，
  // 用户无法区分「本期确实没有数据」与「文件没取到」
  withFetch(["demands", "capabilities"]);
  const snapshot = await loadSnapshot(makeManifest(), PERIOD_ID);

  assert.equal(snapshot.quality.status, "warning");
  const warning = snapshot.quality.warnings.join("、");
  assert.ok(warning.includes("demands"), "缺失的 demands 必须出现在质量警告里");
  assert.ok(warning.includes("capabilities"), "缺失的 capabilities 必须出现在质量警告里");
});

test("flags a missing quality file itself", async () => {
  withFetch(["quality"]);
  const snapshot = await loadSnapshot(makeManifest(), PERIOD_ID);
  assert.equal(snapshot.quality.status, "warning");
  assert.ok(snapshot.quality.warnings.some((item) => item.includes("quality")));
});

test("still degrades gracefully when every file is missing", async () => {
  withFetch([...SNAPSHOT_FILES]);
  const snapshot = await loadSnapshot(makeManifest(), PERIOD_ID);
  // 全丢时也必须把状态标成 warning，而不是假装一切正常
  assert.equal(snapshot.quality.status, "warning");
  assert.equal(snapshot.demands.demands, undefined);
});
