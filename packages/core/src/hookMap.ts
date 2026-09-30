import type { AgentEvent } from "./types.js";
import type { ObservedHook } from "./hookTypes.js";

function labelFromPath(filePath: string | undefined): string {
  if (!filePath) return "An agent";
  const base = filePath.split("/").pop() ?? "a file";
  return `the ${base.replace(/\.[^.]+$/, "")} file`;
}

/** Map a dumped hook payload to a triage event. Never copy raw tool/thought text into headline. */
export function hookToEvent(raw: ObservedHook, now = Date.now()): AgentEvent | null {
  const name = raw.hook_event_name;
  const agentId = raw.generation_id || raw.conversation_id || "unknown";
  if (name === "afterAgentThought" || name === "preToolUse" || name === "postToolUse") {
    return {
      id: crypto.randomUUID(),
      ts: now,
      agentId,
      agentLabel: "Desk agent",
      source: "hook",
      kind: "progress",
      detail: name,
    };
  }
  if (name === "afterFileEdit") {
    const filePath = "file_path" in raw ? String(raw.file_path) : undefined;
    return {
      id: crypto.randomUUID(),
      ts: now,
      agentId,
      agentLabel: "Desk agent",
      source: "hook",
      kind: "file_edit",
      headline: `Edited ${labelFromPath(filePath)}`,
      diffStat: { files: 1, insertions: 0, deletions: 0 },
    };
  }
  if (name === "stop") {
    const status = "status" in raw ? String(raw.status ?? "") : "";
    return {
      id: crypto.randomUUID(),
      ts: now,
      agentId,
      agentLabel: "Desk agent",
      source: "hook",
      kind: status === "error" ? "error" : "finished",
      headline: status === "error" ? "The desk agent hit an error." : "The desk agent finished.",
    };
  }
  return null;
}
