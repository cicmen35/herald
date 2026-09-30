import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function csv(name: string): string[] {
  return env(name)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `https://github.com/acme/app(.git)` -> `acme/app`; anything else -> "". */
export function toOwnerRepo(url: string): string {
  const m = url.trim().match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : "";
}

export interface HeraldConfig {
  cursorApiKey: string;
  testRepo: string;
  repoAllowlist: string[];
  /** GitHub MCP (read-only). Empty token = connector disabled / mock. */
  githubToken: string;
  githubMcpUrl: string;
  /** owner/name form of the allowlisted repos. */
  githubRepos: string[];
  githubPollMs: number;
  startingRef: string;
  openaiApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
  maxConcurrent: number;
  launchCap: number;
  confirmTimeoutMs: number;
  repoRoot: string;
}

export function loadConfig(repoRoot = process.cwd()): HeraldConfig {
  const allow = csv("HERALD_REPO_ALLOWLIST");
  const testRepo = env("HERALD_TEST_REPO");
  const repoAllowlist = allow.length ? allow : testRepo ? [testRepo] : [];
  return {
    cursorApiKey: env("CURSOR_API_KEY"),
    testRepo,
    repoAllowlist,
    githubToken: env("GITHUB_MCP_TOKEN"),
    // `/readonly` makes the hosted server offer read tools only (defence in depth;
    // the client-side tool allowlist is the real gate).
    githubMcpUrl: env("GITHUB_MCP_URL", "https://api.githubcopilot.com/mcp/readonly"),
    githubRepos: repoAllowlist.map(toOwnerRepo).filter(Boolean),
    githubPollMs: Number(env("HERALD_GITHUB_POLL_MS", "45000")) || 45_000,
    startingRef: env("HERALD_STARTING_REF", "main"),
    openaiApiKey: env("OPENAI_API_KEY"),
    llmModel: env("HERALD_LLM_MODEL", "gpt-4.1"),
    llmBaseUrl: env("HERALD_LLM_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, ""),
    maxConcurrent: Number(env("HERALD_MAX_CONCURRENT", "3")) || 3,
    launchCap: Number(env("HERALD_LAUNCH_CAP", "5")) || 5,
    confirmTimeoutMs: Number(env("HERALD_CONFIRM_TIMEOUT_MS", "25000")) || 25_000,
    repoRoot,
  };
}

export function readPrompt(repoRoot: string, name: string): string {
  return readFileSync(resolve(repoRoot, "prompts", name), "utf8");
}
