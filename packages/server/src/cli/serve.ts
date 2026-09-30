#!/usr/bin/env node
import { join } from "node:path";
import { Chief } from "../chief/chief.js";
import { OpenAiLlm, ScriptedLlm } from "../chief/llm.js";
import { loadConfig, readPrompt } from "../config.js";
import { startHttp } from "../http.js";
import { Session } from "../session.js";
import { McpClient } from "../connectors/mcpClient.js";
import { GITHUB_READ_TOOLS, MockGithubConnector, mockPr } from "../connectors/github.js";
import { GithubMcpConnector } from "../connectors/githubMcp.js";
import { GithubPoller } from "../connectors/githubPoller.js";
import { SimWorkerProvider } from "../workers/sim.js";
import { loadDotenv, repoRoot } from "./env.js";

const root = repoRoot();
loadDotenv(root);
const config = loadConfig(root);
if (!config.repoAllowlist.length) {
  config.repoAllowlist = ["https://github.com/example/herald-demo"];
}

const workers = new SimWorkerProvider();
const keyed = Boolean(config.openaiApiKey);
const llm = keyed ? new OpenAiLlm(config) : new ScriptedLlm(config.repoAllowlist[0]!);
const chief = new Chief(workers, llm, config, readPrompt(root, "chief.md"));
const session = new Session(chief, workers, config);

console.log(`Chief LLM: ${keyed ? `${config.llmModel} via ${config.llmBaseUrl}` : "scripted (no key needed)"}`);
console.log("Workers: simulated (no Cursor API key, no spend)");

// GitHub: real (read-only MCP) when a token and repo are configured, else a keyless mock.
const realGithub = Boolean(config.githubToken && config.githubRepos.length);
const mockGithub = new MockGithubConnector([mockPr({ number: 1, ci: "passing" })]);
const connector = realGithub
  ? new GithubMcpConnector(
      new McpClient({ url: config.githubMcpUrl, token: config.githubToken, allowedTools: GITHUB_READ_TOOLS }),
      config.githubRepos,
    )
  : mockGithub;
const github = new GithubPoller(connector, (e) => session.ingestExternal(e), config.githubPollMs);
chief.github = github;
github.start();
console.log(`GitHub: ${realGithub ? `read-only MCP, ${config.githubRepos.join(", ")}` : "mock (set GITHUB_MCP_TOKEN + HERALD_TEST_REPO for real)"}`);

startHttp(session, join(root, "apps", "car-client"), Number(process.env.PORT ?? 8787), {
  github: async (scenario) => {
    if (realGithub) return false; // never fake events against a real repo
    mockGithub.apply(scenario as "ci_fail");
    await github.tick();
    return true;
  },
});
