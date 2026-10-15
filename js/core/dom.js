/**
 * core/dom.js — DOM 构造与通用工具
 *
 * 用 h() 代替模板字符串拼接：文本一律走 textContent，天然免疫 XSS，
 * 也就不再需要 esc() 这类转义函数。约 40 行即可覆盖本项目全部渲染需求。
 */

/**
 * 创建元素。
 * @param {string} tag 标签名
 * @param {Object|null} [props] 属性集合，支持 class / text / dataset / style / onEvent / 原生属性
 * @param {...*} children 子节点，可为节点、字符串、数组、null
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = value;
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key === "style") Object.assign(el.style, value);
      else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
      else el.setAttribute(key, value === true ? "" : String(value));
    }
  }

  append(el, children);
  return el;
}

/** 递归追加子节点 */
function append(parent, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
}

/** 内联 Lucide 图标（sprite 在 index.html 中定义） */
export function icon(name, size) {
  const tpl = document.createElement("template");
  const cls = size ? `icon icon--${size}` : "icon";
  tpl.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
  return tpl.content.firstElementChild;
}

/** 屏幕阅读器专用文本 */
export function srText(text) {
  return h("span", { class: "sr-only", text });
}

export const qs = (sel, root = document) => root.querySelector(sel);

/** 清空容器后批量写入节点 */
export function mount(container, ...nodes) {
  container.replaceChildren(...nodes.filter(Boolean));
}

/** 系统是否要求减弱动态效果 */
export const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 是否移动端布局（与 app.css 的 960px 断点保持一致） */
export const isCompact = () => window.matchMedia("(max-width: 960px)").matches;

/** 数字滚动（缓出），返回取消函数；减弱动态效果时直接落终值 */
export function countUp(el, to, duration = 720) {
  const target = Number(to);
  if (!Number.isFinite(target) || prefersReducedMotion()) {
    el.textContent = String(to);
    return () => {};
  }

  let raf = 0;
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * eased).toLocaleString("zh-CN");
    if (p < 1) raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
