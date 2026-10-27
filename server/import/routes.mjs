import { randomBytes } from "node:crypto";
import { HttpError, json, readJsonBody } from "./http.mjs";
import { parseCookies, validateCsrf, validateOrigin } from "./security.mjs";
import { receiveHtmlUpload } from "./upload.mjs";

function secure(req, config) {
  if (!validateOrigin(req.headers.origin, config)) throw new HttpError(403, "ORIGIN_DENIED", "请求来源不受信任");
  const cookies = parseCookies(req.headers.cookie);
  if (!validateCsrf({ cookieToken: cookies.ai_cockpit_csrf, headerToken: req.headers["x-csrf-token"] })) throw new HttpError(403, "CSRF_DENIED", "请求校验失败");
}

export function createImportRoutes({ store, config }) {
  return async function route(req, res, url) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (req.method === "GET" && url.pathname === "/api/import/session") {
      const token = randomBytes(32).toString("hex");
      const secureFlag = config.allowedOrigin.startsWith("https://") ? "; Secure" : "";
      res.setHeader("set-cookie", `ai_cockpit_csrf=${token}; Path=/api/import/; SameSite=Strict${secureFlag}`);
      json(res, 200, { csrfToken: token });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/import/periods") {
      secure(req, config);
      json(res, 201, await store.createPeriod(await readJsonBody(req)));
      return true;
    }
    if (parts[0] === "api" && parts[1] === "import" && parts[2] === "periods" && parts[3]) {
      const periodId = parts[3];
      if (req.method === "GET" && parts.length === 4) {
        const period = await store.getPeriod(periodId);
        if (!period) throw new HttpError(404, "PERIOD_NOT_FOUND", "期次草稿不存在");
        json(res, 200, { period, draft: await store.getDraft(periodId), quality: await store.getQuality(periodId) });
        return true;
      }
      if (req.method === "POST" && parts[4] === "files") {
        secure(req, config);
        json(res, 201, await receiveHtmlUpload(req, { periodId, store, config }));
        return true;
      }
    }
    return false;
  };
}
