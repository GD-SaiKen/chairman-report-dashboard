import test from "node:test";
import assert from "node:assert/strict";
import { validateExtractionResult } from "../server/import/extraction-schema.mjs";
import { createExtractionProvider } from "../server/import/extraction-provider.mjs";

test("accepts structured AI candidates only when their evidence points to supplied blocks", () => {
  const result = validateExtractionResult({ demands: [{ title: "客诉分析", status: "captured", evidence: { blockId: "block-0001" } }], departments: [], people: [], capabilities: [], tokens: [], radar: [], warnings: [] }, new Set(["block-0001"]));
  assert.equal(result.ok, true);
  assert.equal(validateExtractionResult({ demands: [{ title: "x", status: "delivered", evidence: { blockId: "missing" } }], departments: [], people: [], capabilities: [], tokens: [], radar: [], warnings: [] }, new Set(["block-0001"])).ok, false);
});

test("uses a safe rules-only fallback without provider configuration", async () => {
  const provider = createExtractionProvider({});
  const result = await provider.extract({ blocks: [], ruleResult: { departmentCandidates: [] }, period: { id: "2026-10-27" } });
  assert.equal(result.warnings[0].code, "AI_PROVIDER_MISSING");
});
