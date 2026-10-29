import { timingSafeEqual } from "node:crypto";

/** 归一来源：去掉尾斜杠、小写 scheme 与 host，保留端口 */
export function normalizeOrigin(value) {
  const origin = String(value ?? "").trim().replace(/\/+$/, "");
  if (!origin) return "";
  const matched = origin.match(/^(https?):\/\/([^/]+)$/i);
  if (!matched) return origin.toLowerCase();
  return `${matched[1].toLowerCase()}://${matched[2].toLowerCase()}`;
}

export function validateOrigin(origin, { allowedOrigin } = {}) {
  // 未配置 AI_COCKPIT_ORIGIN 时一律拒绝（fail-closed），由调用方给出明确提示
  if (!allowedOrigin) return false;
  const received = normalizeOrigin(origin);
  return Boolean(received) && received === normalizeOrigin(allowedOrigin);
}

export function validateCsrf({ cookieToken, headerToken }) {
  if (!cookieToken || !headerToken) return false;
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split("=", 2)).filter(([key]) => key));
}
