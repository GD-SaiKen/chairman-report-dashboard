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

test("rejects unsafe period IDs", async () => {
  await assert.rejects(() => new FileImportStore("C:/test/import-store", { fs: memoryFs() }).createPeriod({ id: "../escape" }), /invalid period id/);
});
