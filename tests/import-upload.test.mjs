import test from "node:test";
import assert from "node:assert/strict";
import { validateUpload } from "../server/import/upload.mjs";

const config = { maxFileBytes: 1024, maxPeriodBytes: 4096 };

test("accepts small HTML uploads", () => {
  assert.deepEqual(validateUpload({ filename: "report.html", mime: "text/html", bytes: 1024 }, config), { ok: true });
});

test("rejects non-HTML and over-sized uploads", () => {
  assert.equal(validateUpload({ filename: "report.pdf", mime: "application/pdf", bytes: 1024 }, config).ok, false);
  assert.equal(validateUpload({ filename: "report.html", mime: "text/html", bytes: 1025 }, config).code, "FILE_TOO_LARGE");
});
