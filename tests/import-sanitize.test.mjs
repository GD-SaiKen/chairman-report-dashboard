import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeHtml } from "../server/import/sanitize.mjs";

test("removes executable and remote HTML content", async () => {
  const source = await readFile(new URL("./fixtures/import/unsafe-report.html", import.meta.url), "utf8");
  const result = sanitizeHtml(source);
  assert.doesNotMatch(result.html, /<script|<iframe|onclick|javascript:/i);
  assert.equal(result.remoteResources.length, 1);
  assert.ok(result.warnings.some((item) => item.code === "REMOTE_RESOURCE_REMOVED"));
  assert.ok(result.warnings.some((item) => item.code === "HIDDEN_TEXT_IGNORED"));
});
