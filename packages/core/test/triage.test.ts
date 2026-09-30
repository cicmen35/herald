import { describe, expect, it } from "vitest";
import { triagePriority } from "../src/triage.js";
import type { AgentEvent } from "../src/types.js";

function event(partial: Partial<AgentEvent>): AgentEvent {
  return {
    id: "1",
    ts: 0,
    agentId: "a",
    agentLabel: "Agent one",
    source: "cloud",
    kind: "progress",
    ...partial,
  };
}

describe("triagePriority", () => {
  it("interrupts on blockers", () => {
    expect(triagePriority(event({ kind: "needs_decision" }))).toBe("interrupt");
    expect(triagePriority(event({ kind: "tests_failed" }))).toBe("interrupt");
  });

  it("speaks on finished", () => {
    expect(triagePriority(event({ kind: "finished" }))).toBe("speak");
  });

  it("uses earcons for file edits", () => {
    expect(triagePriority(event({ kind: "file_edit" }))).toBe("earcon");
  });
});
