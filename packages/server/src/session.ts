import { type AgentEvent, type DeskItem, spokenOrFallback } from "@herald/core";
import { Chief } from "./chief/chief.js";
import type { HeraldConfig } from "./config.js";
import { TriageQueue } from "./triageQueue.js";
import type { SimWorkerProvider } from "./workers/sim.js";

export interface OutboundMessage {
  type: "speak" | "earcon" | "mode" | "state" | "desk";
  text?: string;
  priority?: "interrupt" | "speak" | "earcon";
  agentId?: string;
  agentLabel?: string;
  kind?: string;
  mode?: string;
  state?: unknown;
}

type Listener = (msg: OutboundMessage) => void;

/**
 * One driving session: owns the Chief, the triage queue, and the fan-out to the
 * car client. Keeps every spoken string behind the sanitiser.
 */
export class Session {
  private listeners = new Set<Listener>();
  private readonly triage: TriageQueue;
  private activeAgents = new Set<string>();

  constructor(
    readonly chief: Chief,
    private readonly workers: SimWorkerProvider,
    private readonly config: HeraldConfig,
  ) {
    this.triage = new TriageQueue({
      cooldownMs: 30_000,
      coalesceMs: 5_000,
      quiet: () => this.chief.quiet,
      activeAgentCount: () => this.activeAgents.size,
    });
    this.workers.onEvent((event) => this.ingest(event));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener({ type: "state", state: this.snapshot() });
    return () => this.listeners.delete(listener);
  }

  async utterance(text: string): Promise<OutboundMessage[]> {
    const turn = await this.chief.handleUtterance(text);
    const out: OutboundMessage[] = [];
    if (turn.text) {
      this.chief.lastSpokenTier0 = turn.text;
      out.push({ type: "speak", text: turn.text, priority: "speak" });
    }
    out.push({ type: "mode", mode: turn.mode });
    for (const msg of out) this.broadcast(msg);
    this.broadcast({ type: "state", state: this.snapshot() });
    return out;
  }

  /** Events from connectors (GitHub). Same triage and sanitiser path as workers. */
  ingestExternal(event: AgentEvent): void {
    this.ingest(event);
  }

  seed(): void {
    this.workers.seed();
  }

  trigger(scenario: string, label: string): void {
    this.workers.trigger(scenario as "finish", label);
  }

  snapshot() {
    return {
      mode: this.chief.mode,
      quiet: this.chief.quiet,
      pending: this.chief.policy.pending?.readback ?? null,
      openQuestion: this.chief.openQuestion?.question ?? null,
      deskCount: this.chief.desk.filter((d) => !d.done).length,
      launches: this.chief.policy.launchesThisDrive,
      launchCap: this.config.launchCap,
      activeAgents: this.activeAgents.size,
    };
  }

  /** Worker output is untrusted data: only triage-built, sanitised lines are spoken. */
  private ingest(event: AgentEvent): void {
    if (event.kind === "started") this.activeAgents.add(event.agentId);
    if (event.kind === "finished" || event.kind === "error" || event.kind === "tests_failed") {
      this.activeAgents.delete(event.agentId);
    }

    if (event.source === "github") this.deskPr(event);

    const decision = this.triage.admit(event);
    if (decision.priority === "silent") return;

    if (!decision.briefing) {
      this.broadcast({
        type: "earcon",
        agentId: event.agentId,
        agentLabel: event.agentLabel,
        kind: event.kind,
        priority: "earcon",
      });
      return;
    }

    const line = spokenOrFallback(decision.briefing.tiers[0], event.agentLabel);
    // GitHub events have no worker to answer, so they never become an open question.
    if (
      event.source !== "github" &&
      (event.kind === "needs_decision" || event.kind === "tests_failed" || event.risk === "high")
    ) {
      this.chief.openQuestion = {
        agentId: event.agentId,
        agentLabel: event.agentLabel,
        question: decision.briefing.tiers[1] ?? line,
        tier1: decision.briefing.tiers[1],
      };
    }
    this.chief.lastSpokenTier0 = line;
    this.broadcast({
      type: "speak",
      text: line,
      priority: decision.briefing.priority === "interrupt" ? "interrupt" : "speak",
      agentId: event.agentId,
      agentLabel: event.agentLabel,
      kind: event.kind,
    });
    this.broadcast({ type: "state", state: this.snapshot() });
  }

  /** A PR that needs eyes goes to the Desk queue with its link (never spoken). */
  private deskPr(event: AgentEvent): void {
    const pr = event.links?.pr;
    if (!pr || event.kind === "finished") return;
    const desk = this.chief.desk;
    if (desk.some((d) => !d.done && d.links.pr === pr)) return;
    const item: DeskItem = {
      id: crypto.randomUUID(),
      createdAt: event.ts,
      agentId: event.agentId,
      reason: "review_diff",
      note: event.headline ?? "Pull request to review.",
      links: { pr },
      done: false,
    };
    desk.push(item);
  }

  private broadcast(msg: OutboundMessage): void {
    for (const listener of this.listeners) listener(msg);
  }
}
