#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDotenv, repoRoot } from "./env.js";
import { loadConfig } from "../config.js";
import { CursorCloudProvider } from "../workers/cursorCloud.js";

async function main() {
  const root = repoRoot();
  loadDotenv(root);
  const config = loadConfig(root);
  const outDir = join(root, ".herald", "spikes");
  mkdirSync(outDir, { recursive: true });

  if (!config.cursorApiKey) {
    console.error("Missing CURSOR_API_KEY. Put it in .env (see .env.example).");
    process.exit(2);
  }
  if (!config.testRepo) {
    console.error("Missing HERALD_TEST_REPO (https://github.com/org/repo the key can use).");
    process.exit(2);
  }

  const provider = new CursorCloudProvider({ apiKey: config.cursorApiKey });
  const log: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    repo: config.testRepo,
    steps: [] as unknown[],
  };

  const t0 = Date.now();
  console.log("launch…");
  const handle = await provider.launch({
    task: "Reply with the single word PONG. Do not create, edit, or delete any files. Do not open a pull request.",
    repo: config.testRepo,
    branch: config.startingRef,
    autoCreatePR: false,
  });
  (log.steps as unknown[]).push({ step: "launch", ms: Date.now() - t0, handle });
  console.log(JSON.stringify(handle, null, 2));

  const pollUntil = Date.now() + 90_000;
  let lastStatus = await provider.status(handle.id);
  (log.steps as unknown[]).push({ step: "status_initial", body: lastStatus });
  console.log("poll…", lastStatus.agentStatus, lastStatus.runStatus);
  while (Date.now() < pollUntil) {
    await sleep(3000);
    lastStatus = await provider.status(handle.id);
    (log.steps as unknown[]).push({
      step: "poll",
      ms: Date.now() - t0,
      agentStatus: lastStatus.agentStatus,
      runStatus: lastStatus.runStatus,
      headline: lastStatus.headline,
    });
    console.log(Date.now() - t0, "ms", lastStatus.agentStatus, lastStatus.runStatus);
    const run = lastStatus.runStatus ?? "";
    if (["FINISHED", "ERROR", "CANCELLED", "EXPIRED"].includes(run) || lastStatus.agentStatus === "IDLE") {
      break;
    }
  }

  const convoT = Date.now();
  const convo = await provider.conversation(handle.id);
  (log.steps as unknown[]).push({ step: "conversation", ms: Date.now() - convoT, turns: convo });
  console.log("conversation turns", convo.length);

  if ((lastStatus.runStatus ?? "") === "FINISHED" || lastStatus.agentStatus === "IDLE") {
    const fuT = Date.now();
    try {
      const fu = await provider.followup(handle.id, "Confirm you did not change any files. One sentence.");
      (log.steps as unknown[]).push({ step: "followup", ms: Date.now() - fuT, fu });
      console.log("followup", fu);
      await sleep(3000);
      const after = await provider.status(handle.id);
      (log.steps as unknown[]).push({ step: "status_after_followup", body: after });
    } catch (err) {
      (log.steps as unknown[]).push({
        step: "followup_error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    (log.steps as unknown[]).push({
      step: "followup_skipped",
      reason: "run not idle/finished yet",
      lastStatus,
    });
  }

  const stopT = Date.now();
  await provider.stop(handle.id);
  (log.steps as unknown[]).push({ step: "stop", ms: Date.now() - stopT });
  const listed = await provider.list();
  (log.steps as unknown[]).push({ step: "list_after_stop", count: listed.length });
  log.finishedAt = new Date().toISOString();
  log.totalMs = Date.now() - t0;

  const out = join(outDir, "cloud-agent.json");
  writeFileSync(out, JSON.stringify(log, null, 2));
  console.log("wrote", out);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
