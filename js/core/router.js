import { ROUTES } from "./dashboard-schema.js";

export function parseRoute(hash = "") {
  const route = (hash.replace(/^#/, "").split("?")[0] || "overview").trim();
  return ROUTES.includes(route) ? route : "overview";
}

/** 生成路由链接；带 query 时用于部门下钻这类需要参数的入口 */
export function routeHref(route, query = {}) {
  const target = ROUTES.includes(route) ? route : "overview";
  const search = new URLSearchParams(
    Object.entries(query).filter(([, value]) => value != null && value !== ""),
  ).toString();
  return `#${target}${search ? `?${search}` : ""}`;
}

export function routeQuery(hash = "") {
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return Object.fromEntries(new URLSearchParams(query));
}

export function subscribeRoute(listener) {
  const onHashChange = () => listener(parseRoute(window.location.hash), routeQuery(window.location.hash));
  window.addEventListener("hashchange", onHashChange);
  onHashChange();
  return () => window.removeEventListener("hashchange", onHashChange);
}
