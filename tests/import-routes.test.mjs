import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImportConfig } from "../server/import/config.mjs";
import { createImportRoutes } from "../server/import/routes.mjs";
import { FileImportStore } from "../server/import/store.mjs";
import { SNAPSHOT_FILE_KEYS } from "../js/core/dashboard-schema.js";

const ORIGIN = "http://localhost:5175";
const CSRF = { origin: ORIGIN, cookie: "ai_cockpit_csrf=tok123", "x-csrf-token": "tok123" };

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

async function makeEnv({ originConfigured = true, services = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), "crd-routes-"));
  const storageRoot = join(root, ".local-data", "import-storage");
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "data", "manifest.json"), `${JSON.stringify(seedManifest())}\n`, "utf8");
  const store = new FileImportStore(storageRoot);
  const config = {
    ...createImportConfig({ root, storageRoot }),
    root, storageRoot,
    allowedOrigin: originConfigured ? ORIGIN : "",
    originConfigured,
  };
  const routes = createImportRoutes({ store, config, services });
  return { root, store, config, routes, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function request(routes, { method, path, headers = {}, body = "" }) {
  const buffer = Buffer.from(body);
  const req = {
    method, headers, url: path,
    async *[Symbol.asyncIterator]() { yield buffer; },
    pipe() {},
  };
  const res = {
    statusCode: 0, body: null,
    writeHead(status) { this.statusCode = status; },
    end(payload) { this.body = payload; },
  };
  try {
    const handled = await routes(req, res, new URL(path, "http://localhost"));
    return { handled, status: res.statusCode, value: res.body ? JSON.parse(res.body) : null };
  } catch (error) {
    return { thrown: error, status: error.status || 500, code: error.code, message: error.message };
  }
}

async function makeApproved(env) {
  await request(env.routes, { method: "POST", path: "/api/import/periods", headers: CSRF, body: JSON.stringify({ id: "2026-10-27", label: "2026-10-27 期", window: "2026-10-27 ~ 11-02", asOf: "2026-11-02T18:00:00+08:00" }) });
  const period = await env.store.getPeriod("2026-10-27");
  await env.store.savePeriod("2026-10-27", { ...period, status: "review_required" });
  await request(env.routes, { method: "POST", path: "/api/import/periods/2026-10-27/approve", headers: CSRF, body: JSON.stringify({ actor: "信息部" }) });
  await env.store.saveDraft("2026-10-27", { period: { id: "2026-10-27", label: "2026-10-27 期", window: "2026-10-27 ~ 11-02", asOf: "2026-11-02T18:00:00+08:00" }, candidates: {}, quality: { status: "ok", issues: [] } });
  return env.store.getPeriod("2026-10-27");
}

test("publish failure returns the period to approved so it can be retried", async () => {
  const env = await makeEnv({ services: { publish: async () => { throw new Error("磁盘写入失败"); } } });
  try {
    await makeApproved(env);
    const result = await request(env.routes, { method: "POST", path: "/api/import/periods/2026-10-27/publish", headers: CSRF, body: JSON.stringify({ actor: "信息部" }) });
    assert.match(result.message, /磁盘写入失败/);
    // 关键：不能停在 publishing —— 那会让期次再也无法重试
    assert.equal((await env.store.getPeriod("2026-10-27")).status, "approved");
  } finally {
    await env.cleanup();
  }
});

test("a period that failed to publish can then publish successfully", async () => {
  let fail = true;
  const env = await makeEnv({ services: { publish: async () => { if (fail) throw new Error("磁盘写入失败"); return { releaseId: "r1", periodId: "2026-10-27", manifest: seedManifest() }; } } });
  try {
    await makeApproved(env);
    await request(env.routes, { method: "POST", path: "/api/import/periods/2026-10-27/publish", headers: CSRF, body: JSON.stringify({ actor: "信息部" }) });
    assert.equal((await env.store.getPeriod("2026-10-27")).status, "approved");

    fail = false;
    const retried = await request(env.routes, { method: "POST", path: "/api/import/periods/2026-10-27/publish", headers: CSRF, body: JSON.stringify({ actor: "信息部" }) });
    assert.equal(retried.status, 200);
    assert.equal((await env.store.getPeriod("2026-10-27")).status, "published");
  } finally {
    await env.cleanup();
  }
});

test("rejects a second publish of an already published period", async () => {
  const env = await makeEnv();
  try {
    await makeApproved(env);
    const first = await request(env.routes, { method: "POST", path: "/api/import/periods/2026-10-27/publish", headers: CSRF, body: JSON.stringify({ actor: "信息部" }) });
    assert.equal(first.status, 200);
    // 清单真的落盘了，而不只是接口回了 200
    const manifest = JSON.parse(await readFile(join(env.root, "data", "manifest.json"), "utf8"));
    assert.equal(manifest.defaultPeriodId, "2026-10-27");
    assert.ok(manifest.periods.some((item) => item.id === "2026-10-27"));

    const second = await request(env.routes, { method: "POST", path: "/api/import/periods/2026-10-27/publish", headers: CSRF, body: JSON.stringify({ actor: "信息部" }) });
    assert.equal(second.status, 409);
    assert.equal(second.code, "NOT_APPROVED");
  } finally {
    await env.cleanup();
  }
});

test("writes are refused with an actionable reason when origin is unconfigured", async () => {
  const env = await makeEnv({ originConfigured: false });
  try {
    const result = await request(env.routes, { method: "POST", path: "/api/import/periods", headers: CSRF, body: JSON.stringify({ id: "2026-10-27", label: "x", window: "y", asOf: null }) });
    assert.equal(result.status, 403);
    // 必须说明是配置缺失，否则运维只看到一个空洞的 ORIGIN_DENIED
    assert.equal(result.code, "ORIGIN_NOT_CONFIGURED");
  } finally {
    await env.cleanup();
  }
});

test("rejects cross-origin reads and writes", async () => {
  const env = await makeEnv();
  try {
    await makeApproved(env);
    const evil = { origin: "https://evil.example.com", cookie: "ai_cockpit_csrf=tok123", "x-csrf-token": "tok123" };
    const write = await request(env.routes, { method: "POST", path: "/api/import/periods/2026-10-27/approve", headers: evil, body: JSON.stringify({ actor: "信息部" }) });
    assert.equal(write.status, 403);
    assert.equal(write.code, "ORIGIN_DENIED");

    // 跨站发起的读请求必然带 Origin，来源不符同样拒绝
    const read = await request(env.routes, { method: "GET", path: "/api/import/periods/2026-10-27", headers: evil });
    assert.equal(read.status, 403);

    // 不带 Origin 的读请求（例如直接访问 URL）仍然放行
    const direct = await request(env.routes, { method: "GET", path: "/api/import/periods/2026-10-27", headers: {} });
    assert.equal(direct.status, 200);
  } finally {
    await env.cleanup();
  }
});

test("malformed period ids are reported as client errors", async () => {
  const env = await makeEnv();
  try {
    const result = await request(env.routes, { method: "GET", path: "/api/import/periods/not-a-date", headers: {} });
    assert.equal(result.status, 400);
    assert.equal(result.code, "INVALID_PERIOD_ID");
  } finally {
    await env.cleanup();
  }
});

test("creating a period without asOf fails immediately with 422 instead of at publish time", async () => {
  const env = await makeEnv();
  try {
    const result = await request(env.routes, {
      method: "POST", path: "/api/import/periods", headers: CSRF,
      body: JSON.stringify({ id: "2026-12-01", label: "缺截至时间", window: "2026-12-01 ~ 12-07" }),
    });
    assert.equal(result.status, 422);
    assert.equal(result.code, "ASOF_REQUIRED");
    assert.equal(await env.store.getPeriod("2026-12-01"), null);
  } finally {
    await env.cleanup();
  }
});
