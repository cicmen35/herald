import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Chief } from "../src/chief/chief.js";
import { ScriptedLlm } from "../src/chief/llm.js";
import type { HeraldConfig } from "../src/config.js";
import { SimWorkerProvider } from "../src/workers/sim.js";

const repo = "https://github.com/acme/app";

function config(): HeraldConfig {
  return {
    cursorApiKey: "",
    testRepo: repo,
    repoAllowlist: [repo],
    githubToken: "",
    githubMcpUrl: "",
    githubRepos: [],
    githubPollMs: 45_000,
    startingRef: "main",
    openaiApiKey: "",
    llmModel: "",
    llmBaseUrl: "",
    maxConcurrent: 3,
    launchCap: 5,
    confirmTimeoutMs: 25_000,
    repoRoot: mkdtempSync(join(tmpdir(), "herald-")),
  };
}

function chief(workers = new SimWorkerProvider()) {
  return { workers, chief: new Chief(workers, new ScriptedLlm(repo), config(), "Chief.") };
}

describe("keyless Chief", () => {
  it("confirms any spoken task, not just a scripted one", async () => {
    const { chief: c } = chief();
    const turn = await c.handleUtterance("start an agent to add rate limiting to the billing API");
    expect(turn.mode).toBe("CONFIRM");
    expect(turn.text).toMatch(/rate limiting to the billing API/);
    expect(turn.text).toMatch(/Go ahead\?$/);
  });

  it("refuses merge and deploy by voice", async () => {
    const { workers, chief: c } = chief();
    const turn = await c.handleUtterance("start an agent to merge the release branch");
    expect(turn.mode).not.toBe("CONFIRM");
    expect(turn.text.toLowerCase()).toMatch(/can't merge|desk/);
    expect(c.policy.pending).toBeNull();
    expect(await workers.list()).toHaveLength(0);
  });

  it("relays a spoken answer to the agent that asked", async () => {
    const { workers, chief: c } = chief();
    const handle = await workers.launch({ task: "billing", repo });
    c.openQuestion = {
      agentId: handle.id,
      agentLabel: "Agent two",
      question: "New table or a column?",
    };
    const turn = await c.handleUtterance("use a new table");
    expect(turn.text).toMatch(/Passed it on/);
    expect(c.openQuestion).toBeNull();
    const turns = await workers.conversation(handle.id);
    expect(turns[0]?.result).toMatch(/new table/i);
    workers.dispose();
  });

  it("goes quiet and reports the desk when parked", async () => {
    const { chief: c } = chief();
    expect((await c.handleUtterance("quiet mode on")).mode).toBe("LISTEN");
    expect(c.quiet).toBe(true);
    await c.handleUtterance("save that for my desk");
    const parked = await c.handleUtterance("I am parked");
    expect(parked.mode).toBe("PARKED");
    expect(parked.text).toMatch(/One item saved for your desk/);
  });
});
