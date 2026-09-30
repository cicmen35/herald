import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/intents.js";
import type { PendingAction } from "../src/types.js";

const pending: PendingAction = {
  id: "p1",
  tool: "launch_agent",
  args: {},
  readback: "Go ahead?",
  expiresAt: Date.now() + 10_000,
};

describe("parseIntent", () => {
  it("maps yes to approve only when confirmation is pending", () => {
    expect(parseIntent("yes", { mode: "CONFIRM", pending }).type).toBe("approve");
    expect(parseIntent("yes", { mode: "TALK", pending: null }).type).toBe("unknown");
  });

  it("maps cancel to reject", () => {
    expect(parseIntent("no", { mode: "CONFIRM", pending }).type).toBe("reject");
  });

  it("maps a launch phrase to new_task", () => {
    const i = parseIntent("start an agent to add a health-check endpoint", {
      mode: "TALK",
      pending: null,
    });
    expect(i.type).toBe("new_task");
  });
});
