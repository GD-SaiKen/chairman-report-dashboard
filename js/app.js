/**
 * app.js — 装配层
 *
 * 唯一持有状态与副作用的文件：读数据 → 写 store → 渲染 → 绑定交互。
 * 视图函数保持纯函数，所有 DOM 事件、观察器、定时器都在这里集中管理，
 * 便于在 render 前后成对地「销毁 / 重建」，避免切换期次时重复绑定。
 */

import { createStore } from "./core/store.js";
import { loadManifest, loadSnapshot, selectPeriod, DashboardDataError } from "./core/dashboard-data.js";
import { parseRoute, routeQuery, subscribeRoute } from "./core/router.js";
import { h, qs, mount, icon, isCompact } from "./core/dom.js";
import { renderBrand, renderNav, renderSidebarFoot, selectField } from "./ui/shell.js";
import { renderOverview } from "./ui/overview.js";
import { renderDepartments } from "./ui/departments.js";
import { renderDemands } from "./ui/demands.js";
import { renderCapabilities } from "./ui/capabilities.js";
import { renderTokens } from "./ui/tokens.js";
import { renderRadar } from "./ui/radar.js";
import { qualityBadge } from "./ui/shared.js";

/* ------------------------------ 常量 ------------------------------ */

const MANIFEST_URL = "data/manifest.json";
const STORAGE = { theme: "crd:theme", period: "crd:period" };
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
  manifest: null,
  snapshot: null,
  periodId: null,
  route: parseRoute(location.hash),
  query: routeQuery(location.hash),
  error: "",
  theme: readTheme(),
});

/** 当前期次对象 */
const currentPeriod = (state) =>
  state.manifest && selectPeriod(state.manifest, state.periodId);

/* ------------------------------ 侧效果容器 ------------------------------ */

let revealObserver = null;
let clockTimer = null;
let scrollTick = 0;
let drawerOpen = false;
let snapshotRequest = 0;

/* ============================ 渲染 ============================ */

/** 订阅入口：任何 set 之后都全量重渲染（数据量小，简单优先） */
store.subscribe(render);

function render(state) {
  refs.root.dataset.theme = state.theme;
  syncThemeButton(state.theme);

  if (state.status === "loading") {
    mount(refs.main, loadingView());
    return;
  }

  if (state.status === "error") {
    mount(refs.main, errorView(state.error));
    refs.periodHost.replaceChildren();
    refs.crumb.replaceChildren();
    return;
  }

  renderReady(state);
}

function renderReady(state) {
  const { manifest, snapshot } = state;
  const period = currentPeriod(state);
  const quality = snapshot?.quality || { status: "missing", warnings: ["质量文件不可用"] };

  /* 顶栏：面包屑 + 期次下拉 */
  refs.crumb.textContent = period.label;
  refs.periodHost.replaceChildren(selectField(manifest, period.id), qualityBadge(quality));
  qs("#period-select").addEventListener("change", onPeriodChange);

  /* 侧栏：品牌 / 锚点 / 报告入口 */
  mount(
    refs.sidebar,
    renderBrand(manifest.site),
    renderNav(state.route),
    renderSidebarFoot(period, qualityBadge(quality))
  );

  /* 主区：结论条 → 仪表带 → 三块区 → 两扇门 */
  mount(
    refs.main,
    renderRoute(state.route, snapshot, state.query)
  );

  afterRender();
}

function renderRoute(route, snapshot, query) {
  if (route === "departments") return renderDepartments(snapshot, query);
  if (route === "demands") return renderDemands(snapshot, query);
  if (route === "capabilities") return renderCapabilities(snapshot, query);
  if (route === "tokens") return renderTokens(snapshot, query);
  if (route === "radar") return renderRadar(snapshot, query);
  return renderOverview(snapshot, query);
}

function loadingView() {
  return h("section", { class: "dash-empty dashboard-page" },
    h("strong", { text: "正在加载公司 AI 运转快照…" }),
    h("span", { text: "正在读取期次清单与专题数据" }));
}

function errorView(message) {
  // 错误信息一律走 textContent：里头可能含有来自数据文件的路径与文案
  return h("section", { class: "dash-empty dashboard-page" },
    h("strong", { text: "数据加载失败" }),
    h("span", { text: String(message || "未知错误") }));
}

/** 每次重渲染后重建观察器（先销毁，后创建） */
function afterRender() {
  observeReveal();
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
        revealObserver.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.05 }
  );

  document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));
}

/** 滚动监听：顶栏投影 */
function onScroll() {
  if (scrollTick) return;
  scrollTick = requestAnimationFrame(() => {
    scrollTick = 0;
    updateTopbarShadow();
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
  const manifest = store.get().manifest;
  const next = manifest?.periods.find((p) => p.id === nextId);
  if (!next) return;

  try {
    localStorage.setItem(STORAGE.period, nextId);
  } catch {
    /* 忽略写入失败 */
  }

  const requestId = ++snapshotRequest;
  store.set({ status: "loading", periodId: nextId });
  loadSnapshot(manifest, nextId).then((snapshot) => {
    // 丢弃过期响应：快速连切两次时，先发的慢请求不能覆盖用户最后选的期次
    if (requestId !== snapshotRequest) return;
    store.set({ status: "ready", snapshot });
    announce(`已切换到 ${next.label}，数据窗口 ${next.window}`);
  }).catch((error) => {
    if (requestId !== snapshotRequest) return;
    store.set({ status: "error", error: error.message || String(error) });
  });
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

function readSavedPeriod(manifest) {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE.period);
  } catch {
    /* 忽略 */
  }
  return manifest.periods.some((p) => p.id === saved) ? saved : manifest.defaultPeriodId;
}

async function boot() {
  bindOnce();
  startClock();

  try {
    const manifest = await loadManifest(MANIFEST_URL);
    const periodId = readSavedPeriod(manifest);
    const requestId = ++snapshotRequest;
    const snapshot = await loadSnapshot(manifest, periodId);
    if (requestId !== snapshotRequest) return;
    store.set({ manifest, snapshot, periodId, status: "ready" });
  } catch (error) {
    const message =
      error instanceof DashboardDataError
        ? error.message
        : `发生未预期错误：${error && error.message ? error.message : error}`;
    store.set({ status: "error", error: message });
  }
}

subscribeRoute((route, query) => store.set({ route, query }));
boot();
