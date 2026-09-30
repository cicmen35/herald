#!/usr/bin/env node
/**
 * M0 spike: connect to the GitHub MCP server read-only, list tools, call a few
 * read tools, and dump raw payloads to .herald/raw/mcp/ so parsers are written
 * from observed data. Never prints the token.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpClient } from "../connectors/mcpClient.js";
import { GITHUB_READ_TOOLS } from "../connectors/github.js";
import { loadConfig } from "../config.js";
import { loadDotenv, repoRoot } from "./env.js";

const root = repoRoot();
loadDotenv(root);
const config = loadConfig(root);
if (!config.githubToken) {
  console.error("Set GITHUB_MCP_TOKEN in .env");
  process.exit(2);
}

const outDir = join(root, ".herald", "raw", "mcp");
mkdirSync(outDir, { recursive: true });
let n = 0;
const dump = (label: string, data: unknown) => {
  const file = join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${++n}-${label}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
};

const mcp = new McpClient({
  url: config.githubMcpUrl,
  token: config.githubToken,
  allowedTools: GITHUB_READ_TOOLS,
  timeoutMs: 15_000,
  onRaw: (tool, args, raw) => dump(tool, { args, raw }),
});

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  const t0 = Date.now();
  try {
    const v = await fn();
    console.log(`ok   ${label}  ${Date.now() - t0}ms`);
    return v;
  } catch (err) {
    console.log(`FAIL ${label}  ${Date.now() - t0}ms  ${String(err).slice(0, 200)}`);
    return undefined;
  }
}

const tools = await timed("listTools", () => mcp.listToolNames());
if (tools) {
  dump("tools", tools);
  console.log(`server offers ${tools.length} tools`);
  const missing = GITHUB_READ_TOOLS.filter((t) => !tools.includes(t));
  if (missing.length) console.log("allowlisted but not offered:", missing.join(", "));
  const risky = tools.filter((t) => /merge|delete|push|create|update|write|trigger|fork/.test(t));
  console.log(`write-ish tools offered (must stay blocked): ${risky.length}`);
}

const me = (await timed("get_me", () => mcp.callTool("get_me"))) as { login?: string } | undefined;
console.log("signed in as:", me?.login ?? "(unknown)");

const repo = config.githubRepos[0];
if (!repo) {
  console.log("No repo configured. Set HERALD_TEST_REPO=https://github.com/<owner>/<repo> to test PR/CI reads.");
} else {
  const [owner, name] = repo.split("/");
  console.log(`repo: ${repo}`);
  await timed("list_pull_requests", () =>
    mcp.callTool("list_pull_requests", { owner, repo: name, state: "open", perPage: 5 }),
  );
  await timed("search_pull_requests(review-requested)", () =>
    mcp.callTool("search_pull_requests", { query: `repo:${repo} is:open review-requested:@me`, perPage: 5 }),
  );
  const closed = (await timed("list_pull_requests(closed)", () =>
    mcp.callTool("list_pull_requests", { owner, repo: name, state: "closed", sort: "updated", direction: "desc", perPage: 3 }),
  )) as Array<{ number?: number }> | undefined;
  const first = Array.isArray(closed) ? closed[0]?.number : undefined;
  if (first) {
    for (const method of ["get_check_runs", "get_reviews"]) {
      await timed(`pull_request_read(${method})`, () =>
        mcp.callTool("pull_request_read", { method, owner, repo: name, pullNumber: first }),
      );
    }
  } else {
    console.log("No PRs at all in this repo; open one to verify PR/CI parsing.");
  }
}
await mcp.close();
console.log(`raw payloads: ${outDir}`);
