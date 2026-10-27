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

import { createApp } from "./server/app.mjs";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5175);
const server = createApp();

server.listen(PORT, HOST, () => {
  console.log(`信息部与 Hermes 项目报告已启动  →  http://localhost:${PORT}`);
});
