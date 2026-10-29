/**
 * 极简 DOM 桩（约 90 行，零依赖）。
 * 项目刻意不引入 jsdom，但 ui/* 的渲染缺陷（undefined 泄漏、id 含空格、选择器不命中）
 * 恰恰只在渲染结果里才暴露得出来，所以这里提供刚好够用的 DOM 来断言输出。
 */

class StubNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.nodeType = 1;
    this.attributes = new Map();
    this.childNodes = [];
    this.listeners = new Map();
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
  }

  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", String(value)); }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.childNodes.indexOf(this);
    if (index >= 0) this.parentNode.childNodes.splice(index, 1);
    this.parentNode = null;
  }

  appendChild(child) {
    if (!child) return child;
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  replaceChildren(...nodes) {
    this.childNodes = [];
    for (const node of nodes) this.appendChild(node);
  }

  cloneNode() {
    const copy = new StubNode(this.tagName);
    for (const [name, value] of this.attributes) copy.setAttribute(name, value);
    return copy;
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this.childNodes = [new StubText(String(value))];
  }

  get classList() {
    const self = this;
    return {
      add: (name) => self.setAttribute("class", `${self.getAttribute("class") || ""} ${name}`.trim()),
      remove: (name) => self.setAttribute("class", (self.getAttribute("class") || "").split(/\s+/).filter((item) => item && item !== name).join(" ")),
      toggle: (name, force) => (force ? this.add(name) : this.remove(name)),
      contains: (name) => (self.getAttribute("class") || "").split(/\s+/).includes(name),
    };
  }

  /** 按选择器遍历后代，仅支持本项目实际用到的几种形式 */
  querySelectorAll(selector) {
    const matched = [];
    const match = (node) => {
      const m = selector.match(/^\[([\w-]+)="([^"]*)"\]$/);
      if (m) return node.getAttribute(m[1]) === m[2];
      const cls = selector.match(/^\.([\w-]+)$/);
      if (cls) return (node.getAttribute("class") || "").split(/\s+/).includes(cls[1]);
      return node.tagName === selector.toUpperCase();
    };
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (match(child)) matched.push(child);
        walk(child);
      }
    };
    walk(this);
    return matched;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getElementById(id) { return this.querySelectorAll(`[id="${id}"]`)[0] || null; }
}

class StubText {
  constructor(value) {
    this.nodeType = 3;
    this.textContent = String(value);
  }
}

class StubTemplate extends StubNode {
  constructor() {
    super("template");
    // 图标用 <template>.innerHTML 解析 SVG 片段，桩里只需保证能取到首个子节点
    this.content = { firstElementChild: new StubNode("svg") };
  }

  set innerHTML(value) { this.rawHTML = String(value); }
  get innerHTML() { return this.rawHTML || ""; }
}

/** 安装全局 document，返回反安装函数 */
export function installDom() {
  const document = {
    createElement: (tag) => (tag === "template" ? new StubTemplate() : new StubNode(tag)),
    createTextNode: (value) => new StubText(value),
    getElementById: (id) => document.body.getElementById(id),
    querySelector: (selector) => document.body.querySelector(selector),
    querySelectorAll: (selector) => document.body.querySelectorAll(selector),
    body: new StubNode("body"),
  };
  globalThis.document = document;
  return () => { delete globalThis.document; };
}

/** 把节点序列化成 HTML 字符串，便于断言渲染结果里没有脏值 */
export function serialize(node) {
  if (node.nodeType === 3) return escapeHtml(node.textContent);
  const attrs = [...node.attributes].map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join("");
  const children = node.childNodes.map(serialize).join("");
  return `<${node.tagName.toLowerCase()}${attrs}>${children}</${node.tagName.toLowerCase()}>`;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
