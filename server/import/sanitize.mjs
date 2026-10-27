import { parse, serialize } from "parse5";

const DROP = new Set(["script", "iframe", "object", "embed", "form", "base"]);
const REMOTE_ATTRS = new Set(["src", "href", "action"]);

function walk(node, visitor, parent = null) {
  visitor(node, parent);
  for (const child of [...(node.childNodes || [])]) walk(child, visitor, node);
}

function textOf(node) {
  if (node.nodeName === "#text") return node.value || "";
  return (node.childNodes || []).map(textOf).join("");
}

function isRemote(value) { return /^(https?:)?\/\//i.test(value || ""); }
function isDangerous(value) { return /^(javascript:|data:text\/html)/i.test(value || ""); }

export function sanitizeHtml(source) {
  const document = parse(source);
  const warnings = [];
  const remoteResources = [];
  let removedNodeCount = 0;
  walk(document, (node, parent) => {
    const tag = node.tagName;
    if (tag && DROP.has(tag) && parent) {
      parent.childNodes = parent.childNodes.filter((child) => child !== node);
      removedNodeCount += 1;
      return;
    }
    if (tag === "meta" && node.attrs?.some((attr) => attr.name.toLowerCase() === "http-equiv" && attr.value.toLowerCase() === "refresh") && parent) {
      parent.childNodes = parent.childNodes.filter((child) => child !== node);
      removedNodeCount += 1;
      return;
    }
    if (!node.attrs) return;
    const hidden = node.attrs.some((attr) => attr.name === "hidden" || (attr.name === "style" && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attr.value)));
    if (hidden && textOf(node).trim()) warnings.push({ code: "HIDDEN_TEXT_IGNORED", message: "已忽略隐藏文本" });
    node.attrs = node.attrs.filter((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith("on") || isDangerous(value)) return false;
      if (REMOTE_ATTRS.has(name) && isRemote(value)) {
        remoteResources.push(value);
        warnings.push({ code: "REMOTE_RESOURCE_REMOVED", message: "已移除远程资源" });
        return false;
      }
      return true;
    });
  });
  return { html: serialize(document), document, warnings, remoteResources, removedNodeCount };
}
