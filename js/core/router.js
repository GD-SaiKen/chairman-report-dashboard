import { ROUTES } from "./dashboard-schema.js";

export function parseRoute(hash = "") {
  const route = (hash.replace(/^#/, "").split("?")[0] || "overview").trim();
  return ROUTES.includes(route) ? route : "overview";
}

export function routeHref(route) {
  return `#${ROUTES.includes(route) ? route : "overview"}`;
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
