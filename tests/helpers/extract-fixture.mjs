import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { extractPeriod } from "../../server/import/pipeline.mjs";

const FIXTURE_DIR = dirname(fileURLToPath(new URL("../fixtures/import/full-report.html", import.meta.url)));

/**
 * 用真实 HTML 报告跑一遍完整抽取链路（sanitize → segment → 规则抽取 → 合并），返回草稿。
 *
 * 绝不能手工构造 candidates 再喂给 snapshotFromDraft：那样会绕过抽取与合并，
 * 正是「六个专题四个为空」长期没被测试发现的原因。
 */
export async function draftFromFixture(fixtureName = "full-report.html") {
  let period = {
    id: "2026-10-27", label: "2026-10-27 期", window: "2026-10-27 ~ 11-02",
    asOf: "2026-11-02T18:00:00+08:00", status: "uploaded",
    files: [{ fileId: fixtureName.replace(/\.html$/, ""), title: "测试周报" }],
  };
  let draft;
  const store = {
    uploadDir: () => FIXTURE_DIR,
    getPeriod: async () => period,
    savePeriod: async (_id, value) => { period = value; },
    saveDraft: async (_id, value) => { draft = value; },
    saveQuality: async () => {},
    appendAudit: async () => {},
    transaction: (_id, task) => task(),
  };
  const result = await extractPeriod(period.id, { store });
  return { period: result.period, draft };
}
