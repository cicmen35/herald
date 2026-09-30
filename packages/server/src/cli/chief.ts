#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PRODUCT_NAME } from "@herald/core";
import { loadConfig, readPrompt } from "../config.js";
import { Chief } from "../chief/chief.js";
import { OpenAiLlm, ScriptedLlm } from "../chief/llm.js";
import { CursorCloudProvider } from "../workers/cursorCloud.js";
import { MockWorkerProvider } from "../workers/mock.js";
import { loadDotenv, repoRoot } from "./env.js";

async function main() {
  const root = repoRoot();
  loadDotenv(root);
  const mock = process.argv.includes("--mock");
  const config = loadConfig(root);

  if (mock && !config.repoAllowlist.length) {
    config.repoAllowlist = ["https://github.com/example/herald-test"];
  }
  if (!mock && !config.cursorApiKey) {
    console.error("No CURSOR_API_KEY. Use --mock or set the key in .env.");
    process.exit(2);
  }
  if (!config.repoAllowlist.length) {
    console.error("Set HERALD_TEST_REPO or HERALD_REPO_ALLOWLIST.");
    process.exit(2);
  }

  const workers = mock
    ? new MockWorkerProvider()
    : new CursorCloudProvider({ apiKey: config.cursorApiKey });
  const llm =
    mock || !config.openaiApiKey
      ? new ScriptedLlm(config.repoAllowlist[0] ?? "")
      : new OpenAiLlm(config);
  if (!mock && !config.openaiApiKey) {
    console.error("No OPENAI_API_KEY; using scripted Chief. Pass --mock to silence this.");
  }

  const chief = new Chief(workers, llm, config, readPrompt(root, "chief.md"));
  console.log(`${PRODUCT_NAME} Chief (${mock ? "mock workers" : "cloud workers"}). Type a line, or /quit.`);
  console.log('Try: start an agent to add a health-check endpoint');

  const promptLoop = async (ask: () => Promise<string>) => {
    while (true) {
      const line = (await ask()).trim();
      if (!line) continue;
      if (line === "/quit" || line === "/exit") break;
      const turn = await chief.handleUtterance(line);
      console.log(`[${turn.mode}] ${turn.text}`);
      if (turn.launchedId) console.log(`(launched ${turn.launchedId})`);
    }
  };

  if (!stdin.isTTY) {
    const buffered = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      stdin.on("data", (c) => chunks.push(c as Buffer));
      stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    const queue = buffered
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let i = 0;
    await promptLoop(async () => queue[i++] ?? "/quit");
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  await promptLoop(async () => rl.question("> "));
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
