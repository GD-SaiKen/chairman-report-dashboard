import { createServer } from "node:http";
import { createImportConfig } from "./import/config.mjs";
import { json, sendError } from "./import/http.mjs";
import { serveStaticFile } from "./static-files.mjs";

export function createRequestHandler(options = {}) {
  const config = createImportConfig(options);
  return async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/import/health") {
        json(res, 200, { ok: true, service: "html-import" });
        return;
      }
      if (await serveStaticFile(req, res, config.root)) return;
      json(res, 404, { error: { code: "NOT_FOUND", message: "资源不存在" } });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function createApp(options = {}) {
  return createServer(createRequestHandler(options));
}
