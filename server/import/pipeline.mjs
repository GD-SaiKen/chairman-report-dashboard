import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sanitizeHtml } from "./sanitize.mjs";
import { segmentHtml } from "./segment.mjs";
import { extractByRules } from "./rule-extractor.mjs";
import { createExtractionProvider } from "./extraction-provider.mjs";
import { mergeDraft } from "./merge-draft.mjs";
import { extractDigestCandidates } from "./digest.mjs";
import { transitionImport } from "./state-machine.mjs";

const DEPARTMENTS = ["品质", "制造", "五金", "采购", "人资", "研发/工程", "法务/知识产权", "信息部"].map((name, index) => ({ id: ["quality", "manufacturing", "hardware", "purchasing", "hr", "research", "legal", "information"][index], name }));

/** 读取人工策展数据；缺失时返回 {}，不作为错误 —— 它是可选增强项 */
export async function loadPeriodCuration(curationRoot, periodId) {
  try {
    return JSON.parse(await readFile(join(curationRoot, `${periodId}.json`), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export async function extractPeriod(periodId, { store, provider = createExtractionProvider(), departmentDictionary = DEPARTMENTS, curation = {} }) {
  let period = await store.getPeriod(periodId);
  if (!period?.files?.length) throw new Error("period has no uploaded HTML files");
  period = { ...period, status: transitionImport(period.status, "sanitizing") };
  await store.savePeriod(periodId, period);
  try {
    const ruleResults = [];
    const aiResults = [];
    let digestCandidates = null;
    const primary = period.files.find((file) => file.reportType === "info-weekly") || period.files.find((file) => file.publishOriginal);
    for (const file of period.files) {
      const source = await readFile(join(store.uploadDir(periodId), `${file.fileId}.html`), "utf8");
      const sanitized = sanitizeHtml(source);
      const blocks = segmentHtml(sanitized.document);
      if (file.fileId === primary?.fileId) digestCandidates = extractDigestCandidates(blocks, file.fileId);
      const rules = extractByRules(blocks, { sourceFileId: file.fileId });
      ruleResults.push(rules);
      aiResults.push(await provider.extract({ blocks, ruleResult: rules, period }));
    }
    period.status = transitionImport("sanitizing", "extracting");
    await store.savePeriod(periodId, period);
    period.status = transitionImport("extracting", "validating");
    const draft = {
      ...mergeDraft({ files: period.files, ruleResults, aiResults, curation, departmentDictionary }),
      digestCandidates,
      digest: null,
      period: { id: period.id, label: period.label, window: period.window, asOf: period.asOf },
    };
    await store.saveDraft(periodId, draft);
    await store.saveQuality(periodId, draft.quality);
    period.status = transitionImport("validating", "review_required");
    await store.savePeriod(periodId, period);
    await store.appendAudit(periodId, { type: "extraction_completed", fileCount: period.files.length });
    return { period, draft, quality: draft.quality };
  } catch (error) {
    // 解析失败必须落地成 failed：否则期次会卡在处理中状态，既不能重解析也不能发布。
    // 落状态本身再失败时不能掩盖原始错误，所以单独兜住。
    try {
      await store.savePeriod(periodId, { ...period, status: transitionImport(period.status, "failed") });
    } catch { /* 保留原始错误 */ }
    await store.appendAudit(periodId, { type: "extraction_failed", message: error.message }).catch(() => {});
    throw error;
  }
}
