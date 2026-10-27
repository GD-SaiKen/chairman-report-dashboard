import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeHtml } from "../server/import/sanitize.mjs";
import { segmentHtml } from "../server/import/segment.mjs";
import { extractByRules } from "../server/import/rule-extractor.mjs";

test("extracts evidence-backed departments, tokens and capabilities", async () => {
  const source = await readFile(new URL("./fixtures/import/token-and-capability-report.html", import.meta.url), "utf8");
  const result = extractByRules(segmentHtml(sanitizeHtml(source).document), { sourceFileId: "file-01" });
  assert.equal(result.departmentCandidates[0].name, "品质");
  assert.equal(result.departmentCandidates[0].activeUsers, 8);
  assert.equal(result.tokenCandidates[0].cacheRead, 176201072);
  assert.equal(result.tokenCandidates[0].evidence.sourceFileId, "file-01");
  assert.equal(result.tokenCandidates[0].evidence.method, "rule");
  assert.equal(result.capabilityCandidates[0].type, "agent");
});
