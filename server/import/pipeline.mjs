import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sanitizeHtml } from "./sanitize.mjs";
import { segmentHtml } from "./segment.mjs";
import { extractByRules } from "./rule-extractor.mjs";
import { createExtractionProvider } from "./extraction-provider.mjs";
import { mergeDraft } from "./merge-draft.mjs";
import { transitionImport } from "./state-machine.mjs";

const DEPARTMENTS = ["品质", "制造", "五金", "采购", "人资", "研发/工程", "法务/知识产权", "信息部"].map((name, index) => ({ id: ["quality", "manufacturing", "hardware", "purchasing", "hr", "research", "legal", "information"][index], name }));

export async function extractPeriod(periodId, { store, provider = createExtractionProvider(), departmentDictionary = DEPARTMENTS }) {
  let period = await store.getPeriod(periodId);
  if (!period?.files?.length) throw new Error("period has no uploaded HTML files");
  period = { ...period, status: transitionImport(period.status, "sanitizing") };
  await store.savePeriod(periodId, period);
  const ruleResults = [];
  const aiResults = [];
  for (const file of period.files) {
    const source = await readFile(join(store.uploadDir(periodId), `${file.fileId}.html`), "utf8");
    const sanitized = sanitizeHtml(source);
    const blocks = segmentHtml(sanitized.document);
    const rules = extractByRules(blocks, { sourceFileId: file.fileId });
    ruleResults.push(rules);
    aiResults.push(await provider.extract({ blocks, ruleResult: rules, period }));
  }
  period.status = transitionImport("sanitizing", "extracting");
  await store.savePeriod(periodId, period);
  period.status = transitionImport("extracting", "validating");
  const draft = { ...mergeDraft({ files: period.files, ruleResults, aiResults, curation: {}, departmentDictionary }), period: { id: period.id, label: period.label, window: period.window, asOf: period.asOf } };
  await store.saveDraft(periodId, draft);
  await store.saveQuality(periodId, draft.quality);
  period.status = transitionImport("validating", "review_required");
  await store.savePeriod(periodId, period);
  await store.appendAudit(periodId, { type: "extraction_completed", fileCount: period.files.length });
  return { period, draft, quality: draft.quality };
}
