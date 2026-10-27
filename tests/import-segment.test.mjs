import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeHtml } from "../server/import/sanitize.mjs";
import { segmentHtml } from "../server/import/segment.mjs";

test("turns headings, paragraphs, tables and lists into evidence blocks", async () => {
  const source = await readFile(new URL("./fixtures/import/structured-report.html", import.meta.url), "utf8");
  const blocks = segmentHtml(sanitizeHtml(source).document);
  const heading = blocks.find((item) => item.kind === "heading");
  const table = blocks.find((item) => item.kind === "table");
  assert.equal(heading.sectionTitle, "AI 使用情况");
  assert.equal(table.sectionTitle, "AI 使用情况");
  assert.equal(table.rows[0][0], "部门");
  assert.equal(table.rows[1][1], "8");
});
