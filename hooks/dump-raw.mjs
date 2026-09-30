#!/usr/bin/env node
/**
 * Logging-only Cursor hook. Dumps stdin JSON to .herald/raw/.
 * Sacred: never throw, never block the agent, always exit 0.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PERMISSION_EVENTS = new Set([
  "beforeShellExecution",
  "beforeMCPExecution",
  "beforeReadFile",
  "beforeTabFileRead",
  "beforeSubmitPrompt",
  "subagentStart",
  "preToolUse",
  "preCompact",
]);

function findRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "AGENTS.md"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    const done = () => resolve(Buffer.concat(chunks).toString("utf8"));
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", done);
    process.stdin.on("error", () => resolve(""));
    setTimeout(done, 2000);
  });
}

async function main() {
  const eventName = process.argv[2] && process.argv[2] !== "--self-test" ? process.argv[2] : "unknown";
  const selfTest = process.argv.includes("--self-test");
  const cwd = process.cwd();
  const root = findRoot(cwd);
  const rawDir = join(root, ".herald", "raw");
  const errLog = join(root, ".herald", "hook-errors.log");

  try {
    mkdirSync(rawDir, { recursive: true });
    const stdin = selfTest
      ? JSON.stringify({
          hookEvent: "self-test",
          note: "synthetic payload from hooks/dump-raw.mjs --self-test",
          ts: Date.now(),
        })
      : await readStdin();

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(rawDir, `${stamp}-${eventName}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          receivedAt: new Date().toISOString(),
          eventName,
          cwd,
          argv: process.argv.slice(2),
          stdinRaw: stdin,
          stdinJson: tryParse(stdin),
        },
        null,
        2,
      ),
    );

    if (selfTest) process.stdout.write(`${file}\n`);
    else if (PERMISSION_EVENTS.has(eventName)) process.stdout.write(JSON.stringify({ permission: "allow" }));
    else process.stdout.write("{}");
  } catch (err) {
    try {
      mkdirSync(dirname(errLog), { recursive: true });
      appendFileSync(
        errLog,
        `${new Date().toISOString()} ${eventName} ${err instanceof Error ? err.stack : String(err)}\n`,
      );
    } catch {
      // swallow
    }
    if (PERMISSION_EVENTS.has(eventName)) {
      try {
        process.stdout.write(JSON.stringify({ permission: "allow" }));
      } catch {
        // swallow
      }
    }
  }
  process.exit(0);
}

main();
