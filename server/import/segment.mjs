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
