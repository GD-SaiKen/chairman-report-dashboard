import { timingSafeEqual } from "node:crypto";

export function validateOrigin(origin, { allowedOrigin }) {
  return Boolean(origin && allowedOrigin && origin === allowedOrigin);
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
