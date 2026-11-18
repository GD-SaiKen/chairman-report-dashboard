import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "parse5";
import { readFile } from "node:fs/promises";
import { segmentHtml } from "../server/import/segment.mjs";
import { extractDigestCandidates, reviewDigest, canPublishDigest } from "../server/import/digest.mjs";
import { canApproveDraft } from "../server/import/merge-draft.mjs";

test("extracts report highlights with source evidence and requires review", () => {
  const blocks = segmentHtml(parse(`<h3>主要结论</h3><ul><li>本期完成制造闭环。</li><li>待确认部署状态。</li></ul><h3>本期主要变更</h3><ul><li>异常看板上线。</li></ul><h3>待收口</h3><ul><li>补充基线备份。</li></ul>`));
  const digest = extractDigestCandidates(blocks, "file-1");
  assert.equal(digest.reviewed, false);
  assert.equal(digest.headline.text, "本期完成制造闭环。");
  assert.equal(digest.highlights[0].evidence.sourceFileId, "file-1");
  assert.equal(digest.watchItems[0].text, "补充基线备份。");
  assert.equal(canPublishDigest(digest), false);
  const reviewed = reviewDigest(digest, { headline: digest.headline, highlights: digest.highlights, watchItems: digest.watchItems }, "信息部");
  assert.equal(canPublishDigest(reviewed), true);
  assert.equal(canApproveDraft({ files: [{ reportType: "info-weekly" }], digest: reviewed, quality: { issues: [] } }), true);
  assert.equal(canApproveDraft({ files: [{ reportType: "info-weekly" }], digest, quality: { issues: [] } }), false);
  assert.throws(() => reviewDigest(digest, { headline: { text: "杜撰结论", evidence: { sourceFileId: "other", blockId: "block-99" } }, highlights: [], watchItems: [] }, "信息部"), /原文证据/);
});

test("extracts a usable candidate from the current information department report", async () => {
  const html = await readFile(new URL("../reports/2026-10-12_10-17/info-dept-weekly/index.html", import.meta.url), "utf8");
  const digest = extractDigestCandidates(segmentHtml(parse(html)), "weekly");
  assert.match(digest.headline.text, /11 项变更/);
  assert.ok(digest.highlights.length > 0);
  assert.ok(digest.watchItems.length > 0);
});

test("uses a sourced fallback when a report omits standard section headings", () => {
  const blocks = segmentHtml(parse("<h2>本周工作</h2><p>制造系统完成异常闭环页面并进入试用。</p>"));
  const digest = extractDigestCandidates(blocks, "weekly");
  assert.equal(digest.headline.text, "制造系统完成异常闭环页面并进入试用。");
  assert.equal(digest.headline.evidence.sourceFileId, "weekly");
});

test("reads conclusion cards and keeps one evidence id per judgement", () => {
  const blocks = segmentHtml(parse(`
    <div class="verdict">
      <div class="v-head"><h2>核心结论 · 先看这一屏</h2><span class="v-tag">3 条判断</span></div>
      <div class="vlist">
        <div class="v warn"><div class="v-n">1</div><div>
          <div class="v-t">用量结构分化，增长在个人通道。</div>
          <div class="v-m">网关侧 4,949.11M，会话侧只占 14.1%。</div>
        </div></div>
        <div class="v good"><div class="v-n">2</div><div>
          <div class="v-t">三个新服务上线。</div>
          <div class="v-m">supplier-inbox、yield-gate、srm-mcp。</div>
        </div></div>
        <div class="v"><div class="v-n">3</div><div>
          <div class="v-t">部门维度首次可用。</div>
          <div class="v-m">40 个部门 / 705 名用户有归属。</div>
        </div></div>
        <div class="v warn"><div class="v-n">4</div><div>
          <div class="v-t">项目任务调度超时翻倍。</div>
          <div class="v-m">40 次 Run 中 20 次超时。</div>
        </div></div>
      </div>
    </div>`));

  const verdict = blocks.find((block) => block.kind === "verdict");
  assert.equal(verdict.sectionTitle, "核心结论 · 先看这一屏");
  assert.equal(verdict.items.length, 4);
  assert.deepEqual(verdict.items.map((item) => item.tone), ["warn", "good", "neutral", "warn"]);

  const digest = extractDigestCandidates(blocks, "weekly");
  assert.equal(digest.headline.text, "用量结构分化，增长在个人通道。");
  assert.equal(digest.headline.evidence.excerpt, "网关侧 4,949.11M，会话侧只占 14.1%。");
  // 结论已是第一条判断，不应在「待关注」里重复一次
  assert.deepEqual(digest.highlights.map((item) => item.text), ["三个新服务上线。", "部门维度首次可用。"]);
  assert.deepEqual(digest.watchItems.map((item) => item.text), ["项目任务调度超时翻倍。"]);

  const evidenceIds = [digest.headline, ...digest.highlights, ...digest.watchItems].map((item) => item.evidence.blockId);
  assert.equal(new Set(evidenceIds).size, evidenceIds.length, "每条判断必须有自己的证据 id");

  const reviewed = reviewDigest(digest, { headline: digest.headline, highlights: digest.highlights, watchItems: digest.watchItems }, "信息部");
  assert.equal(canPublishDigest(reviewed), true);
});

test("falls back to heading semantics for reports without conclusion cards", () => {
  const blocks = segmentHtml(parse("<h2>核心结论</h2><ul><li>两条主线都在收口。</li><li>下周补基线备份。</li></ul>"));
  const digest = extractDigestCandidates(blocks, "weekly");
  assert.equal(digest.headline.text, "两条主线都在收口。");
  assert.deepEqual(digest.highlights.map((item) => item.text), ["下周补基线备份。"]);
  assert.deepEqual(digest.watchItems, []);
});

test("prefers remaining key judgements over supporting findings", () => {
  // 10 月 19 日那版周报：核心结论下分「关键判断 / 主要发现 / 建议行动」三段。
  // 判断才是要点，主要发现是佐证，不能顶掉判断去当「关键进展」。
  const blocks = segmentHtml(parse(`
    <h2>核心结论</h2>
    <h3>① 关键判断</h3>
    <ul><li>DSH 是绝对主力。</li><li>托管主体只到可验收。</li><li>两个口径不能相加。（见 #s1）</li></ul>
    <h3>② 主要发现</h3>
    <ul><li>四仓 110 次提交。</li></ul>
    <h3>③ 建议行动</h3>
    <ul><li>补采缺失日期后再对齐。</li></ul>`));
  const digest = extractDigestCandidates(blocks, "weekly");
  assert.equal(digest.headline.text, "DSH 是绝对主力。");
  assert.deepEqual(digest.highlights.map((item) => item.text), ["托管主体只到可验收。", "两个口径不能相加。"]);
  assert.deepEqual(digest.watchItems.map((item) => item.text), ["补采缺失日期后再对齐。"]);
});

test("returns no candidates when a report has neither cards nor known headings", () => {
  const blocks = segmentHtml(parse("<div class=\"card\"><div class=\"num\">42</div></div>"));
  const digest = extractDigestCandidates(blocks, "weekly");
  assert.equal(digest.headline, null);
  assert.deepEqual(digest.highlights, []);
  assert.deepEqual(digest.watchItems, []);
  assert.equal(canPublishDigest(digest), false);
});
