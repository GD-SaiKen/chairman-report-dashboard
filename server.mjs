#!/usr/bin/env node
/**
 * server.mjs — 零依赖本地静态服务
 *
 * 为什么需要它：页面用 fetch() 读取 data/manifest.json 与专题快照，
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
  if (!server.importConfig.originConfigured) {
    // 未配置来源时管理台的写操作会被安全策略全数拒绝，必须提前说明
    console.warn("未设置 AI_COCKPIT_ORIGIN：导入管理台的上传/解析/发布操作将被拒绝。");
    console.warn(`本地可用：AI_COCKPIT_ORIGIN=http://localhost:${PORT} npm start`);
  }
});
