/**
 * 大模型请求本地代理（零依赖，Node 18+ 可直接运行）
 *
 * 用途：某些大模型服务商不允许浏览器直连（CORS 拦截），
 *       本脚本在你自己的电脑上做一层转发，并补上跨域响应头，
 *       这样「智学」前端就能正常调用。
 *
 * 用法：
 *   1) 默认转发到 DeepSeek：
 *        node tools/llm-proxy.mjs
 *   2) 指定上游（推荐显式写清楚）：
 *        set UPSTREAM=https://api.deepseek.com/v1   (Windows CMD)
 *        $env:UPSTREAM="https://api.deepseek.com/v1" (PowerShell)
 *        node tools/llm-proxy.mjs
 *   3) 换端口：
 *        set PORT=8788 && node tools/llm-proxy.mjs
 *
 * 然后在「智学」的大模型设置里：
 *   服务商选「自定义（兼容 OpenAI）」
 *   Base URL 填  http://127.0.0.1:8787/v1
 *   API Key 填   你的真实 Key（代理会原样转发给上游，不会保存）
 *
 * 注意：本代理只监听 127.0.0.1，外网无法访问，仅本机可用。
 */

import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const UPSTREAM = (process.env.UPSTREAM || "https://api.deepseek.com/v1").replace(/\/+$/, "");
const HOST = "127.0.0.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400"
};

function text(res, code, body, extra = {}) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", ...CORS, ...extra });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // 预检请求
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    text(res, 200, `智学大模型代理运行中\n上游: ${UPSTREAM}\n请在应用里把 Base URL 填为 http://${HOST}:${PORT}/v1`);
    return;
  }

  if (!req.url.startsWith("/v1/")) {
    text(res, 404, "只代理 /v1/ 开头的路径");
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const target = UPSTREAM + req.url.slice(3); // 去掉 /v1 前缀后拼接
    const headers = { "Content-Type": "application/json" };
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        ...CORS
      });
      res.end(buf);
      console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url} -> ${upstream.status}`);
    } catch (e) {
      console.error("转发失败:", e.message);
      text(res, 502, "代理转发失败：" + e.message + "\n请检查 UPSTREAM 地址是否正确、本机能否访问该地址。");
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log("=========================================");
  console.log("  智学 · 大模型本地代理已启动");
  console.log(`  监听:  http://${HOST}:${PORT}/v1`);
  console.log(`  上游:  ${UPSTREAM}`);
  console.log("-----------------------------------------");
  console.log("  在应用里：服务商选「自定义（兼容 OpenAI）」，");
  console.log(`  Base URL 填 http://${HOST}:${PORT}/v1，Key 填你的真实 Key`);
  console.log("  关闭窗口即停止代理。");
  console.log("=========================================");
});
