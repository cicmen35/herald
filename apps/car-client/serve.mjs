#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const body = await readFile(join(dir, path));
    res.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, "0.0.0.0", () => {
  console.log(`Voice spike http://127.0.0.1:${port}/`);
  console.log("On a phone, use HTTPS via cloudflared/ngrok; mic fails on plain LAN IP in Safari.");
});
