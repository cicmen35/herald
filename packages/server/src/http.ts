import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { Session } from "./session.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

export interface HttpHooks {
  /** Demo-only GitHub scenarios (ci_fail | review | merged | changes). Return false if unavailable. */
  github?: (scenario: string) => Promise<boolean>;
}

export function startHttp(session: Session, clientDir: string, port: number, hooks: HttpHooks = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const unsubscribe = session.subscribe((msg) => {
        res.write(`data: ${JSON.stringify(msg)}\n\n`);
      });
      const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return;
    }

    if (url.pathname === "/api/utterance" && req.method === "POST") {
      const body = await readBody(req);
      let text = "";
      try {
        text = String((JSON.parse(body) as { text?: string }).text ?? "");
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }
      const out = await session.utterance(text);
      json(res, { messages: out, state: session.snapshot() });
      return;
    }

    if (url.pathname === "/api/sim" && req.method === "POST") {
      const body = await readBody(req);
      const { scenario, label } = JSON.parse(body || "{}") as { scenario?: string; label?: string };
      if (scenario?.startsWith("gh_")) {
        const ok = (await hooks.github?.(scenario.slice(3))) ?? false;
        json(res, { ok, state: session.snapshot() });
        return;
      }
      if (scenario === "seed") session.seed();
      else session.trigger(scenario ?? "finish", label ?? "Simulated task");
      json(res, { ok: true, state: session.snapshot() });
      return;
    }

    if (url.pathname === "/api/state") {
      json(res, session.snapshot());
      return;
    }

    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = await readFile(join(clientDir, safe));
      res.writeHead(200, { "Content-Type": MIME[extname(safe)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Herald car client  http://127.0.0.1:${port}/`);
    console.log("Phone: expose over HTTPS (cloudflared/ngrok); Safari blocks mic on plain http.");
  });
  return server;
}

function json(res: import("node:http").ServerResponse, body: unknown) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
