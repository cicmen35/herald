export type Priority = "interrupt" | "speak" | "earcon" | "silent";
export type Tier = 0 | 1 | 2;
export type Mode = "LISTEN" | "BRIEFING" | "TALK" | "CONFIRM" | "PARKED";

export interface AgentEvent {
  id: string;
  ts: number;
  agentId: string;
  agentLabel: string;
  source: "cloud" | "hook" | "mcp" | "chief" | "github";
  kind:
    | "started"
    | "progress"
    | "finished"
    | "blocked"
    | "needs_decision"
    | "tests_failed"
    | "error"
    | "file_edit";
  headline?: string;
  detail?: string;
  diffStat?: { files: number; insertions: number; deletions: number };
  decision?: { question: string; options?: string[] };
  risk?: "low" | "medium" | "high";
  links?: { pr?: string; agentUrl?: string };
}

export interface Briefing {
  id: string;
  eventIds: string[];
  agentId: string;
  priority: Priority;
  tiers: { 0: string; 1?: string; 2?: string };
  spokenTier: Tier;
  createdAt: number;
  status: "queued" | "speaking" | "spoken" | "skipped" | "dismissed";
}

export interface DeskItem {
  id: string;
  createdAt: number;
  agentId: string;
  reason: "review_diff" | "long_decision" | "ambiguous" | "user_deferred";
  note: string;
  links: { pr?: string; agentUrl?: string };
  done: boolean;
}

export interface PendingAction {
  id: string;
  tool: string;
  args: unknown;
  readback: string;
  expiresAt: number;
}

export type Intent =
  | { type: "more" }
  | { type: "walkthrough" }
  | { type: "repeat" }
  | { type: "skip" }
  | { type: "stop" }
  | { type: "quiet_on" }
  | { type: "quiet_off" }
  | { type: "recap" }
  | { type: "back_to_music" }
  | { type: "new_task"; text: string }
  | { type: "answer"; text: string }
  | { type: "approve" }
  | { type: "reject" }
  | { type: "focus_agent"; ref: string }
  | { type: "queue_for_desk" }
  | { type: "parked" }
  | { type: "unknown" };

export interface WorkerHandle {
  id: string;
  label: string;
  url?: string;
  latestRunId?: string;
}

export interface WorkerStatus {
  id: string;
  label: string;
  agentStatus: string;
  runStatus?: string;
  headline?: string;
  result?: string;
  url?: string;
  latestRunId?: string;
}

export interface ConversationTurn {
  runId: string;
  status: string;
  result?: string;
  createdAt?: string;
}

export interface LaunchRequest {
  task: string;
  repo: string;
  branch?: string;
  autoCreatePR?: boolean;
}
