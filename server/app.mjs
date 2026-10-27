import { createServer } from "node:http";
import { createImportConfig } from "./import/config.mjs";
import { json, sendError } from "./import/http.mjs";
import { createImportRoutes } from "./import/routes.mjs";
import { FileImportStore } from "./import/store.mjs";
import { serveStaticFile } from "./static-files.mjs";

export function createRequestHandler(options = {}) {
  const config = createImportConfig(options);
  const routes = createImportRoutes({ store: options.store || new FileImportStore(config.storageRoot), config });
  return async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/import/health") {
        json(res, 200, { ok: true, service: "html-import" });
        return;
      }
      if (await routes(req, res, url)) return;
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
