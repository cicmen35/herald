import {
  type AgentEvent,
  type Briefing,
  type Priority,
  spokenOrElse,
  spokenOrFallback,
  triagePriority,
} from "@herald/core";

export interface TriageOptions {
  /** At most one non-interrupt spoken briefing per this window. */
  cooldownMs: number;
  /** Events from one agent inside this window coalesce. */
  coalesceMs: number;
  quiet: () => boolean;
  activeAgentCount: () => number;
}

export interface TriageDecision {
  priority: Priority;
  briefing?: Briefing;
  reason: string;
}

/** Deterministic triage: decides whether the driver hears a sentence, an earcon, or nothing. */
export class TriageQueue {
  /** Negative infinity so the first briefing of a drive is never in cooldown. */
  private lastSpokenAt = Number.NEGATIVE_INFINITY;
  private lastByAgent = new Map<string, { ts: number; kind: string }>();

  constructor(private readonly opts: TriageOptions) {}

  admit(event: AgentEvent, now = Date.now()): TriageDecision {
    let priority = triagePriority(event);

    const previous = this.lastByAgent.get(event.agentId);
    if (previous && now - previous.ts < this.opts.coalesceMs && previous.kind === event.kind) {
      return { priority: "silent", reason: "duplicate within coalesce window" };
    }
    this.lastByAgent.set(event.agentId, { ts: now, kind: event.kind });

    if (this.opts.quiet() && priority !== "interrupt") {
      return { priority: "earcon", reason: "quiet mode" };
    }

    if (priority === "speak" && now - this.lastSpokenAt < this.opts.cooldownMs) {
      return { priority: "earcon", reason: "cooldown" };
    }

    if (priority === "earcon" || priority === "silent") {
      return { priority, reason: "routine" };
    }

    const complex = this.isComplex(event);
    const tiers = this.buildTiers(event, complex);
    if (priority === "speak" || priority === "interrupt") {
      this.lastSpokenAt = now;
    }

    const briefing: Briefing = {
      id: crypto.randomUUID(),
      eventIds: [event.id],
      agentId: event.agentId,
      priority,
      tiers,
      spokenTier: 0,
      createdAt: now,
      status: "queued",
    };
    return { priority, briefing, reason: complex ? "complexity gate" : "needs the driver" };
  }

  /** A diff too big to judge by ear, or a multi-part decision, goes to the desk. */
  private isComplex(event: AgentEvent): boolean {
    if (event.risk === "high") return true;
    if ((event.diffStat?.files ?? 0) > 10) return true;
    if ((event.decision?.options?.length ?? 0) > 2) return true;
    return false;
  }

  private buildTiers(event: AgentEvent, complex: boolean): Briefing["tiers"] {
    if (event.source === "github") {
      // Headline is a code-built template (counts + PR number), never PR text.
      const line = spokenOrElse(event.headline ?? "", "Something changed on GitHub. It's saved for your desk.");
      return { 0: line, 1: spokenOrElse(`${line} I've saved the details for your desk.`, line) };
    }
    const named = this.opts.activeAgentCount() > 1;
    const who = named ? `${event.agentLabel}` : "The agent";
    const safeWho = spokenOrFallback(who, "An agent").replace(/\.$/, "");

    if (complex) {
      return {
        0: spokenOrFallback(`${safeWho} needs you, and it's a bigger call. Want it now, or saved for your desk?`),
        1: spokenOrFallback(`${safeWho} finished something large. It really wants eyes on a screen, so I can save it for your desk.`),
      };
    }

    if (event.kind === "needs_decision" && event.decision) {
      const question = spokenOrFallback(event.decision.question, event.agentLabel);
      const options = event.decision.options ?? [];
      const tier0 = options.length
        ? `${safeWho} needs a decision: ${options[0]}, or ${options[1] ?? "something else"}?`
        : `${safeWho} needs a decision.`;
      return {
        0: spokenOrFallback(tier0, event.agentLabel),
        1: question,
      };
    }

    if (event.kind === "tests_failed") {
      return {
        0: spokenOrFallback(`${safeWho} says tests are failing after the change.`),
        1: spokenOrFallback(`${safeWho} finished the work, but the test run is red. Want it retried, or saved for your desk?`),
      };
    }

    if (event.kind === "error") {
      return { 0: spokenOrFallback(`${safeWho} hit an error and stopped.`) };
    }

    const files = event.diffStat?.files;
    const scale = files ? ` It touched about ${roundish(files)} files.` : "";
    return {
      0: spokenOrFallback(event.headline ?? `${safeWho} finished.`, event.agentLabel),
      1: spokenOrFallback(`${safeWho} finished.${scale}`, event.agentLabel),
    };
  }
}

function roundish(n: number): string {
  if (n <= 2) return "a couple of";
  if (n <= 5) return "a handful of";
  if (n <= 15) return "a dozen";
  return "several dozen";
}
