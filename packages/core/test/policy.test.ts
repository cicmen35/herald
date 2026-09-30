import { describe, expect, it } from "vitest";
import {
  approvePending,
  assertLaunchAllowed,
  newPolicyState,
  requestConfirmation,
} from "../src/policy.js";

const config = {
  repoAllowlist: ["https://github.com/acme/app"],
  maxConcurrent: 3,
  launchCap: 5,
  confirmTimeoutMs: 1000,
};

describe("policy", () => {
  it("blocks repos not on the allowlist", () => {
    const state = newPolicyState();
    const r = assertLaunchAllowed(state, config, {
      task: "add a health check",
      repo: "https://github.com/evil/app",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_allowlisted");
  });

  it("does not execute on timeout", () => {
    const state = newPolicyState();
    requestConfirmation(state, "launch_agent", {}, "Go ahead?", 0, 10);
    const r = approvePending(state, 50);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("expired");
    expect(state.pending).toBeNull();
  });

  it("requires an approve after readback", () => {
    const state = newPolicyState();
    const pending = requestConfirmation(state, "launch_agent", { task: "x" }, "Go ahead?", 0, 1000);
    expect(state.pending?.id).toBe(pending.id);
    const r = approvePending(state, 10);
    expect(r.ok).toBe(true);
    expect(state.pending).toBeNull();
  });
});
