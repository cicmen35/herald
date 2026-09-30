import type { LaunchRequest, PendingAction } from "./types.js";

export const TOOLS_REQUIRING_CONFIRM = new Set(["launch_agent", "stop_agent"]);

export const FORBIDDEN_TOOLS = new Set([
  "merge",
  "deploy",
  "delete",
  "force_push",
  "delete_branch",
]);

export interface PolicyConfig {
  repoAllowlist: string[];
  maxConcurrent: number;
  launchCap: number;
  confirmTimeoutMs: number;
}

export interface PolicyState {
  pending: PendingAction | null;
  launchesThisDrive: number;
  activeAgentIds: Set<string>;
}

export type PolicyDenial =
  | { ok: false; code: "forbidden_tool"; message: string }
  | { ok: false; code: "not_allowlisted"; message: string }
  | { ok: false; code: "concurrent_cap"; message: string }
  | { ok: false; code: "launch_cap"; message: string }
  | { ok: false; code: "needs_confirm"; pending: PendingAction }
  | { ok: false; code: "expired"; message: string }
  | { ok: false; code: "no_pending"; message: string }
  | { ok: false; code: "mismatch"; message: string };

export type PolicyOk<T> = { ok: true; value: T };

function normalizeRepo(url: string): string {
  return url.trim().replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
}

export function isRepoAllowed(repo: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  const needle = normalizeRepo(repo);
  return allowlist.some((allowed) => normalizeRepo(allowed) === needle);
}

/** Spoken-safe reason for any denial, including the confirm case. */
export function denialMessage(denial: PolicyDenial): string {
  if (denial.code === "needs_confirm") return denial.pending.readback;
  return denial.message;
}

export function newPolicyState(): PolicyState {
  return { pending: null, launchesThisDrive: 0, activeAgentIds: new Set() };
}

export function isPendingExpired(pending: PendingAction | null, now: number): boolean {
  return !!pending && pending.expiresAt <= now;
}

export function readbackForLaunch(req: LaunchRequest): string {
  const branch = req.branch ? ` on ${req.branch}` : "";
  return `I'll start an agent to ${req.task.replace(/\.$/, "")}${branch}, with tests, and open a pull request. Go ahead?`;
}

export function readbackForStop(id: string): string {
  return `I'll stop the agent ${id}. Go ahead?`;
}

export function requestConfirmation(
  state: PolicyState,
  tool: string,
  args: unknown,
  readback: string,
  now: number,
  timeoutMs: number,
): PendingAction {
  const pending: PendingAction = {
    id: crypto.randomUUID(),
    tool,
    args,
    readback,
    expiresAt: now + timeoutMs,
  };
  state.pending = pending;
  return pending;
}

export function assertLaunchAllowed(
  state: PolicyState,
  config: PolicyConfig,
  req: LaunchRequest,
): PolicyDenial | { ok: true } {
  if (!isRepoAllowed(req.repo, config.repoAllowlist)) {
    return {
      ok: false,
      code: "not_allowlisted",
      message: "That repo isn't on the allowlist. I've saved nothing.",
    };
  }
  if (state.activeAgentIds.size >= config.maxConcurrent) {
    return {
      ok: false,
      code: "concurrent_cap",
      message: "Too many agents are already running. Try after one finishes.",
    };
  }
  if (state.launchesThisDrive >= config.launchCap) {
    return {
      ok: false,
      code: "launch_cap",
      message: "Launch cap for this drive is reached. Saved for your desk.",
    };
  }
  return { ok: true };
}

export function approvePending(
  state: PolicyState,
  now: number,
): PolicyDenial | { ok: true; pending: PendingAction } {
  const pending = state.pending;
  if (!pending) {
    return { ok: false, code: "no_pending", message: "Nothing is waiting on a yes." };
  }
  if (isPendingExpired(pending, now)) {
    state.pending = null;
    return { ok: false, code: "expired", message: "That confirmation timed out, so I cancelled it." };
  }
  state.pending = null;
  return { ok: true, pending };
}

export function rejectPending(state: PolicyState): void {
  state.pending = null;
}

export function recordLaunch(state: PolicyState, agentId: string): void {
  state.launchesThisDrive += 1;
  state.activeAgentIds.add(agentId);
}

export function recordStop(state: PolicyState, agentId: string): void {
  state.activeAgentIds.delete(agentId);
}
