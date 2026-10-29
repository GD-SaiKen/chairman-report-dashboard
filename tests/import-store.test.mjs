import test from "node:test";
import assert from "node:assert/strict";
import { FileImportStore } from "../server/import/store.mjs";

function memoryFs() {
  const files = new Map();
  const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });
  return {
    mkdir: async () => {},
    writeFile: async (path, value) => files.set(path, String(value)),
    readFile: async (path) => files.has(path) ? files.get(path) : Promise.reject(missing()),
    rename: async (from, to) => { if (!files.has(from)) throw missing(); files.set(to, files.get(from)); files.delete(from); },
    appendFile: async (path, value) => files.set(path, `${files.get(path) || ""}${value}`),
  };
}

test("persists a period through a new store instance", async () => {
  const fs = memoryFs();
  const first = new FileImportStore("C:/test/import-store", { fs });
  await first.createPeriod({ id: "2026-10-27", label: "2026-10-27 期", window: "2026-10-27 ~ 11-02", asOf: "2026-11-02T18:00:00+08:00" });
  const second = new FileImportStore("C:/test/import-store", { fs });
  assert.equal((await second.getPeriod("2026-10-27")).status, "uploaded");
});

test("rejects unsafe period IDs as client errors", async () => {
  let error;
  try {
    await new FileImportStore("C:/test/import-store", { fs: memoryFs() }).createPeriod({ id: "../escape" });
  } catch (thrown) {
    error = thrown;
  }
  assert.ok(error, "非法期次 ID 必须被拒绝");
  // 非法 id 是客户端错误，必须映射成 400 而不是 500
  assert.equal(error.status, 400);
  assert.equal(error.code, "INVALID_PERIOD_ID");
});

test("serializes read-modify-write for the same period", async () => {
  const fs = memoryFs();
  const store = new FileImportStore("C:/test/import-store", { fs });
  await store.createPeriod({ id: "2026-10-27", label: "x", window: "y", asOf: null });
  let order = [];
  const slow = (name, delay) => store.transaction("2026-10-27", async () => {
    const period = await store.getPeriod("2026-10-27");
    await new Promise((done) => setTimeout(done, delay));
    await store.savePeriod("2026-10-27", { ...period, label: name });
    return name;
  });
  await Promise.all([slow("first", 30), slow("second", 1)]);
  // 后写者必须看到前写者的结果，串行化保证不丢失更新
  assert.equal((await store.getPeriod("2026-10-27")).label, "second");
});
