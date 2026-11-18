const CONCISE = (text) => String(text || "")
  // 报告里的「（见 #s1）」是站内锚点提示，放进导读只会让结论读起来像草稿
  .replace(/（见[^）]*#[^）]*）/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 280);

function candidate(text, block, sourceFileId, extra = {}) {
  const concise = CONCISE(text);
  return {
    text: concise,
    evidence: {
      sourceFileId,
      blockId: extra.blockId || block.id,
      sectionTitle: block.sectionTitle,
      excerpt: extra.excerpt ? CONCISE(extra.excerpt) : concise,
    },
  };
}

const CONCLUSION_TITLE = /核心结论|主要结论|本期结论|关键判断/;
const PROGRESS_TITLE = /主要变更|核心改动|关键进展|本期核心改动|主要发现/;
const WATCH_TITLE = /待办|风险|待收口|待关注|未解决|建议行动/;

/**
 * 结论卡优先。
 *
 * 周报生成器把「一句话判断 + 支撑数据」放在 .verdict 卡片里（.v-t 标题 / .v-m 支撑），
 * 这些内容是 div，不会进入段落/列表块；若只按标题找列表，新版周报会一条候选都提不出来。
 * 这里按结论卡自身的语义取：第 1 条判断作结论，good 作关键进展，warn 作待关注。
 *
 * 证据 id 必须逐条唯一：reviewDigest 只按 (sourceFileId, blockId) 校验来源，
 * 若同一张卡片共用 blockId，审核人改写文本时就没有任何原文约束了。
 */
function verdictCandidates(block, sourceFileId) {
  const [headline, ...rest] = block.items;
  const good = rest.filter((item) => item.tone === "good");
  const neutral = rest.filter((item) => item.tone === "neutral");
  const warn = rest.filter((item) => item.tone === "warn");

  return {
    headline: candidate(headline.title, block, sourceFileId, { blockId: `${block.id}#headline`, excerpt: headline.detail }),
    highlights: [...good, ...neutral].slice(0, 6).map((item, index) =>
      candidate(item.title, block, sourceFileId, { blockId: `${block.id}#highlight-${index}`, excerpt: item.detail })),
    watchItems: warn.slice(0, 4).map((item, index) =>
      candidate(item.title, block, sourceFileId, { blockId: `${block.id}#watch-${index}`, excerpt: item.detail })),
    reviewed: false,
  };
}

export function extractDigestCandidates(blocks, sourceFileId) {
  const verdict = blocks.find((block) => block.kind === "verdict" && (block.items || []).length);
  if (verdict) return verdictCandidates(verdict, sourceFileId);

  // 兜底：按章节标题语义，从列表与段落里取候选（没有结论卡的老报告）
  const conclusions = [], progress = [], watch = [], fallback = [];
  for (const block of blocks) {
    if (block.kind !== "list" && block.kind !== "paragraph") continue;
    const title = block.sectionTitle || "";
    const items = block.kind === "list" ? block.items || [] : [block.text];
    for (const item of items) {
      if (!CONCISE(item)) continue;
      fallback.push(candidate(item, block, sourceFileId));
      if (WATCH_TITLE.test(title)) watch.push(candidate(item, block, sourceFileId));
      else if (CONCLUSION_TITLE.test(title)) conclusions.push(candidate(item, block, sourceFileId));
      else if (PROGRESS_TITLE.test(title)) progress.push(candidate(item, block, sourceFileId));
    }
  }
  return {
    headline: conclusions[0] || progress[0] || fallback[0] || null,
    // 有多条「关键判断」时，它们本身就是本期要点；只有一条时才退到「主要发现」
    highlights: (conclusions.length > 1 ? conclusions.slice(1) : progress).slice(0, 6),
    watchItems: (watch.length ? watch : conclusions.filter((item) => /待|风险|必须/.test(item.text))).slice(0, 4),
    reviewed: false,
  };
}

export function reviewDigest(candidates, selected, actor) {
  if (!String(actor || "").trim()) throw new Error("请填写审核人");
  const allowed = [candidates.headline, ...candidates.highlights, ...candidates.watchItems].filter(Boolean);
  const valid = (item) => item && typeof item.text === "string" && item.text.trim().length >= 4 && item.text.length <= 280 && allowed.some((source) => source.evidence.sourceFileId === item.evidence?.sourceFileId && source.evidence.blockId === item.evidence?.blockId);
  if (!valid(selected.headline)) throw new Error("导读结论必须关联报告原文证据");
  if (!Array.isArray(selected.highlights) || selected.highlights.length > 3 || !selected.highlights.every(valid)) throw new Error("关键进展最多三项，且必须关联原文");
  if (!Array.isArray(selected.watchItems) || selected.watchItems.length > 2 || !selected.watchItems.every(valid)) throw new Error("待关注最多两项，且必须关联原文");
  return { headline: selected.headline, highlights: selected.highlights, watchItems: selected.watchItems, reviewed: true, reviewer: String(actor).trim() };
}

export function canPublishDigest(digest) {
  return Boolean(digest?.reviewed && digest?.headline?.text && digest?.reviewer);
}
