function norm(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function textOf(node) { return node.nodeName === "#text" ? node.value || "" : (node.childNodes || []).map(textOf).join(""); }
function hidden(node) { return (node.attrs || []).some((attr) => attr.name === "hidden" || (attr.name === "style" && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attr.value))); }
function descendants(node, names) {
  const items = [];
  const visit = (current) => {
    if (names.includes(current.tagName)) items.push(current);
    for (const child of current.childNodes || []) visit(child);
  };
  visit(node);
  return items;
}
function tableRows(table) { return descendants(table, ["tr"]).map((row) => descendants(row, ["th", "td"]).map((cell) => norm(textOf(cell)))); }

/* ---------- 结论卡：周报生成器用 .verdict/.vlist/.v（.v-t 标题 / .v-m 支撑） ---------- */

function classTokens(node) {
  const attr = (node.attrs || []).find((item) => item.name === "class");
  return attr ? attr.value.split(/\s+/).filter(Boolean) : [];
}

function hasClass(node, name) {
  return Boolean(node.tagName) && classTokens(node).includes(name);
}

function firstByClass(node, name) {
  if (hasClass(node, name)) return node;
  for (const child of node.childNodes || []) {
    const found = firstByClass(child, name);
    if (found) return found;
  }
  return null;
}

/** warn / risk 是风险，good / ok 是交付；其余为中性判断 */
function verdictTone(node) {
  const tokens = classTokens(node);
  if (tokens.includes("warn") || tokens.includes("risk")) return "warn";
  if (tokens.includes("good") || tokens.includes("ok")) return "good";
  return "neutral";
}

function verdictItems(container) {
  const list = firstByClass(container, "vlist");
  if (!list) return [];
  return (list.childNodes || [])
    .filter((child) => hasClass(child, "v"))
    .map((child) => {
      const title = firstByClass(child, "v-t");
      const detail = firstByClass(child, "v-m");
      const text = title ? norm(textOf(title)) : "";
      if (!text) return null;
      return { tone: verdictTone(child), title: text.slice(0, 280), detail: detail ? norm(textOf(detail)).slice(0, 600) : "" };
    })
    .filter(Boolean);
}

export function segmentHtml(document) {
  const blocks = [];
  let sectionTitle = "未分类";
  let index = 0;
  const add = (kind, node, value = {}) => {
    const text = norm(textOf(node));
    if (!text || hidden(node)) return;
    index += 1;
    blocks.push({ id: `block-${String(index).padStart(4, "0")}`, kind, sectionTitle, text: text.slice(0, 6000), locator: `${node.tagName || node.nodeName}:nth-of-type(${index})`, ...value });
  };
  const visit = (node) => {
    if (hidden(node)) return;
    const tag = node.tagName;
    // 结论卡是周报里唯一承载「一句话判断 + 支撑数据」的结构，必须整块保留；
    // 否则卡片里的 div 会被丢弃，导读只能从正文段落里瞎猜一句。
    if (hasClass(node, "verdict")) {
      const items = verdictItems(node);
      if (items.length) {
        const heading = descendants(node, ["h1", "h2", "h3"])[0];
        const title = heading ? norm(textOf(heading)) : "核心结论";
        index += 1;
        blocks.push({
          id: `block-${String(index).padStart(4, "0")}`,
          kind: "verdict",
          sectionTitle: title,
          text: items.map((item) => item.title).join(" / ").slice(0, 6000),
          locator: `verdict:nth-of-type(${index})`,
          items,
        });
        sectionTitle = title;
        return;
      }
    }
    if (/^h[1-6]$/.test(tag || "")) { sectionTitle = norm(textOf(node)); add("heading", node); return; }
    if (tag === "p") { add("paragraph", node); return; }
    if (tag === "ul" || tag === "ol") { add("list", node, { items: descendants(node, ["li"]).map((item) => norm(textOf(item))) }); return; }
    if (tag === "table") { add("table", node, { rows: tableRows(node) }); return; }
    if (tag === "a") { add("link", node, { href: (node.attrs || []).find((attr) => attr.name === "href")?.value || "" }); return; }
    for (const child of node.childNodes || []) visit(child);
  };
  visit(document);
  return blocks;
}
