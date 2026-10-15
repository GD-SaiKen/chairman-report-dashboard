/**
 * app.js — 装配层
 *
 * 唯一持有状态与副作用的文件：读数据 → 写 store → 渲染 → 绑定交互。
 * 视图函数保持纯函数，所有 DOM 事件、观察器、定时器都在这里集中管理，
 * 便于在 render 前后成对地「销毁 / 重建」，避免切换期次时重复绑定。
 */

import { createStore } from "./core/store.js";
import { loadCatalog, summarize, CatalogError } from "./core/catalog.js";
import { h, qs, mount, icon, countUp, isCompact } from "./core/dom.js";
import * as views from "./ui/views.js";

/* ------------------------------ 常量 ------------------------------ */

const CATALOG_URL = "data/catalog.json";
const STORAGE = { theme: "crd:theme", period: "crd:period" };
const SECTION_IDS = ["meters", "judgments", "risks", "decisions"];
const MOBILE_BREAKPOINT = "(max-width: 960px)";

/* ------------------------------ DOM 引用 ------------------------------ */

const refs = {
  root: document.documentElement,
  sidebar: qs("#sidebar"),
  backdrop: qs("#backdrop"),
  menuBtn: qs("#menu-btn"),
  crumb: qs("#crumb-period"),
  periodHost: qs("#period-host"),
  clockTime: qs("#clock-time"),
  themeBtn: qs("#theme-btn"),
  main: qs("#main"),
  live: qs("#live"),
  topbar: qs("#topbar"),
};

/* ------------------------------ 状态 ------------------------------ */

const store = createStore({
  status: "loading", // loading | ready | error
  catalog: null,
  periodId: null,
  error: "",
  theme: readTheme(),
});

/** 当前期次对象 */
const currentPeriod = (state) =>
  state.catalog && state.catalog.periods.find((p) => p.id === state.periodId);

/* ------------------------------ 侧效果容器 ------------------------------ */

let revealObserver = null;
let clockTimer = null;
let scrollTick = 0;
let drawerOpen = false;

/* ============================ 渲染 ============================ */

/** 订阅入口：任何 set 之后都全量重渲染（数据量小，简单优先） */
store.subscribe(render);

function render(state) {
  refs.root.dataset.theme = state.theme;
  syncThemeButton(state.theme);

  if (state.status === "loading") {
    mount(refs.main, views.renderLoading());
    return;
  }

  if (state.status === "error") {
    mount(refs.main, views.renderError(state.error));
    refs.periodHost.replaceChildren();
    refs.crumb.replaceChildren();
    return;
  }

  renderReady(state);
}

function renderReady(state) {
  const { catalog } = state;
  const period = currentPeriod(state);
  const stats = summarize(period);

  /* 顶栏：面包屑 + 期次下拉 */
  refs.crumb.textContent = period.label;
  refs.periodHost.replaceChildren(views.selectField(catalog, period.id));
  qs("#period-select").addEventListener("change", onPeriodChange);

  /* 侧栏：品牌 / 锚点 / 报告入口 */
  mount(
    refs.sidebar,
    views.renderBrand(catalog.site),
    views.renderNav(period),
    views.renderSidebarFoot(period)
  );

  /* 主区：结论条 → 仪表带 → 三块舱 → 两扇门 */
  mount(
    refs.main,
    views.renderHero(catalog.site, period, stats),
    views.renderMeters(period),
    h(
      "div",
      { class: "grid-3" },
      views.renderJudgments(period),
      views.renderRisks(period),
      views.renderDecisions(period)
    ),
    views.renderDoors(period),
    views.renderFoot(period)
  );

  afterRender();
}

/** 每次重渲染后重建所有观察器与定时器（先销毁，后创建） */
function afterRender() {
  observeReveal();
  updateScrollSpy();
  updateTopbarShadow();
  applyInert();
}

/* ============================ 动效与观察器 ============================ */

function observeReveal() {
  if (revealObserver) revealObserver.disconnect();

  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        const number = entry.target.querySelector("[data-count]");
        if (number) countUp(number, number.dataset.count);
        revealObserver.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.05 }
  );

  document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));
}

/** 滚动监听：高亮侧栏当前区块 + 顶栏投影 */
function onScroll() {
  if (scrollTick) return;
  scrollTick = requestAnimationFrame(() => {
    scrollTick = 0;
    updateScrollSpy();
    updateTopbarShadow();
  });
}

function updateScrollSpy() {
  // 锚定「视口顶部往下一小段」而不是 30% 视口高：
  // 后者在超长视口（如截图、超宽屏）下会把整页都判为已进入
  const threshold = window.scrollY + Math.min(window.innerHeight * 0.35, 180);
  let active = SECTION_IDS[0];

  for (const id of SECTION_IDS) {
    const el = document.getElementById(id);
    if (el && el.getBoundingClientRect().top + window.scrollY <= threshold) active = id;
  }

  // 滚到底时强制定位到最后一节，避免短尾节永远无法激活
  const atBottom =
    window.innerHeight + window.scrollY >=
    (document.body.scrollHeight || document.documentElement.scrollHeight) - 4;
  if (atBottom) active = SECTION_IDS[SECTION_IDS.length - 1];

  document.querySelectorAll('[data-nav="section"]').forEach((link) => {
    const isActive = link.getAttribute("href") === `#${active}`;
    link.classList.toggle("is-active", isActive);
    if (isActive) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
}

function updateTopbarShadow() {
  refs.topbar.classList.toggle("is-stuck", window.scrollY > 4);
}

/* ============================ 时钟 ============================ */

const formatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function startClock() {
  if (clockTimer) clearInterval(clockTimer);
  const tick = () => {
    refs.clockTime.textContent = formatter.format(new Date());
  };
  tick();
  clockTimer = setInterval(tick, 1000);
}

/* ============================ 主题 ============================ */

function readTheme() {
  // 预览 / 回归测试钩子：?theme=light|dark 优先级最高，方便截图与分享固定主题
  const fromUrl = new URLSearchParams(location.search).get("theme");
  if (fromUrl === "light" || fromUrl === "dark") return fromUrl;

  try {
    const saved = localStorage.getItem(STORAGE.theme);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* 隐私模式下 localStorage 不可用，忽略 */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function syncThemeButton(theme) {
  const isDark = theme === "dark";
  const label = isDark ? "切换到浅色主题" : "切换到深色主题";
  refs.themeBtn.replaceChildren(icon(isDark ? "sun" : "moon"));
  refs.themeBtn.setAttribute("aria-label", label);
  refs.themeBtn.setAttribute("title", label);
  refs.themeBtn.setAttribute("aria-pressed", String(isDark));
}

function toggleTheme() {
  const next = store.get().theme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(STORAGE.theme, next);
  } catch {
    /* 忽略写入失败 */
  }
  store.set({ theme: next });
}

/* ============================ 期次切换 ============================ */

function onPeriodChange(event) {
  const nextId = event.target.value;
  const catalog = store.get().catalog;
  const next = catalog.periods.find((p) => p.id === nextId);
  if (!next) return;

  try {
    localStorage.setItem(STORAGE.period, nextId);
  } catch {
    /* 忽略写入失败 */
  }

  store.set({ periodId: nextId });
  announce(`已切换到 ${next.label}，数据窗口 ${next.window}`);
  window.scrollTo({ top: 0, behavior: "auto" });
}

/** 向读屏播报状态变化 */
function announce(message) {
  refs.live.textContent = "";
  requestAnimationFrame(() => {
    refs.live.textContent = message;
  });
}

/* ============================ 移动端抽屉 ============================ */

function openDrawer() {
  if (drawerOpen) return;
  drawerOpen = true;
  refs.sidebar.classList.add("is-open");
  refs.backdrop.hidden = false;
  requestAnimationFrame(() => refs.backdrop.classList.add("is-open"));
  refs.menuBtn.setAttribute("aria-expanded", "true");
  refs.sidebar.inert = false;
  document.addEventListener("keydown", onDrawerKeydown);
  refs.sidebar.querySelector(".nav__link")?.focus();
}

function closeDrawer({ restoreFocus = true } = {}) {
  if (!drawerOpen) return;
  drawerOpen = false;
  refs.sidebar.classList.remove("is-open");
  refs.backdrop.classList.remove("is-open");
  refs.menuBtn.setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", onDrawerKeydown);
  applyInert();

  const hide = () => {
    if (!drawerOpen) refs.backdrop.hidden = true;
  };
  setTimeout(hide, 220);

  if (restoreFocus) refs.menuBtn.focus();
}

/** Esc 关闭；Tab 在抽屉内循环（简易焦点陷阱） */
function onDrawerKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeDrawer();
    return;
  }
  if (event.key !== "Tab") return;

  const focusables = refs.sidebar.querySelectorAll("a[href], button:not([disabled])");
  if (!focusables.length) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** 折叠态抽屉对辅助技术与 Tab 键彻底不可达 */
function applyInert() {
  refs.sidebar.inert = isCompact() && !drawerOpen;
  refs.menuBtn.setAttribute("aria-expanded", String(drawerOpen));
  if (!drawerOpen) refs.backdrop.hidden = true;
}

/* ============================ 启动 ============================ */

function bindOnce() {
  refs.menuBtn.addEventListener("click", openDrawer);
  refs.backdrop.addEventListener("click", () => closeDrawer());
  refs.themeBtn.addEventListener("click", toggleTheme);

  // 事件委托：侧栏链接（含重渲染后的新节点）
  refs.sidebar.addEventListener("click", (event) => {
    if (event.target.closest(".nav__link") && isCompact()) closeDrawer({ restoreFocus: false });
  });

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => {
    if (!isCompact() && drawerOpen) closeDrawer({ restoreFocus: false });
    applyInert();
    updateScrollSpy();
  });

  // 窄屏用 JS 收起抽屉，宽屏恢复常驻
  window.matchMedia(MOBILE_BREAKPOINT).addEventListener("change", () => {
    if (!isCompact() && drawerOpen) closeDrawer({ restoreFocus: false });
    applyInert();
  });

  // 深浅色跟随系统（仅当用户未手动选择过）
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
    let saved = null;
    try {
      saved = localStorage.getItem(STORAGE.theme);
    } catch {
      /* 忽略 */
    }
    if (!saved) store.set({ theme: event.matches ? "dark" : "light" });
  });
}

function readSavedPeriod(catalog) {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE.period);
  } catch {
    /* 忽略 */
  }
  return catalog.periods.some((p) => p.id === saved) ? saved : catalog.defaultId;
}

async function boot() {
  bindOnce();
  startClock();

  try {
    const catalog = await loadCatalog(CATALOG_URL);
    store.set({ catalog, periodId: readSavedPeriod(catalog), status: "ready" });
  } catch (error) {
    const message =
      error instanceof CatalogError
        ? error.message
        : `发生未预期错误：${error && error.message ? error.message : error}`;
    store.set({ status: "error", error: message });
  }
}

boot();
