import test from "node:test";
import assert from "node:assert/strict";
import { validateUpload, decodeFilename } from "../server/import/upload.mjs";

const config = { maxFileBytes: 1024, maxPeriodBytes: 4096 };

test("accepts small HTML uploads", () => {
  assert.deepEqual(validateUpload({ filename: "report.html", mime: "text/html", bytes: 1024 }, config), { ok: true });
});

test("rejects non-HTML and over-sized uploads", () => {
  assert.equal(validateUpload({ filename: "report.pdf", mime: "application/pdf", bytes: 1024 }, config).ok, false);
  assert.equal(validateUpload({ filename: "report.html", mime: "text/html", bytes: 1025 }, config).code, "FILE_TOO_LARGE");
});

test("decodes UTF-8 filenames that busboy read as latin1", () => {
  const original = "信息部周报11月9.html";
  const mangled = Buffer.from(original, "utf8").toString("latin1");
  assert.equal(decodeFilename(mangled), original);
  assert.equal(decodeFilename("weekly-46.html"), "weekly-46.html");
});
