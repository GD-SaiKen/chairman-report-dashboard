#!/usr/bin/env node
/**
 * server.mjs — 零依赖本地静态服务
 *
 * 为什么需要它：项目用 fetch() 读取 data/catalog.json，
 * 浏览器会拦截 file:// 协议下的跨源请求，因此必须从 http 打开。
 * 这里只用 Node 内置模块，不需要 npm install。
 *
 *   npm start            # http://localhost:5175
 *   PORT=6000 npm start  # 换端口
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const ROOT = resolve(process.cwd());
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5175);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** 解析请求路径到磁盘文件；目录命中 index.html；越权路径返回 null */
async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const target = resolve(join(ROOT, normalize(clean)));

  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;

  let info;
  try {
    info = await stat(target);
  } catch {
    return null;
  }

  if (info.isDirectory()) {
    const index = join(target, "index.html");
    try {
      return (await stat(index)).isFile() ? index : null;
    } catch {
      return null;
    }
  }

  return info.isFile() ? target : null;
}

const server = createServer(async (req, res) => {
  const file = await resolveFile(req.url || "/");

  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });

  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`董事长驾驶舱已启动  →  http://localhost:${PORT}`);
});
