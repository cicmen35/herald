import {
  type DeskItem,
  type LaunchRequest,
  type Mode,
  FORBIDDEN_TOOLS,
  TOOLS_REQUIRING_CONFIRM,
  approvePending,
  assertLaunchAllowed,
  denialMessage,
  newPolicyState,
  parseIntent,
  readbackForLaunch,
  readbackForStop,
  recordLaunch,
  recordStop,
  rejectPending,
  requestConfirmation,
  spokenOrFallback,
  type PolicyConfig,
  type PolicyState,
} from "@herald/core";
import { join } from "node:path";
import type { HeraldConfig } from "../config.js";
import { JsonlLedger } from "../ledger.js";
import type { GithubPoller } from "../connectors/githubPoller.js";
import { prStatusHeadline, queueHeadline, summarizeQueue } from "../connectors/github.js";
import type { WorkerProvider } from "../workers/types.js";
import type { ChatMessage, Llm } from "./llm.js";
import { buildTaskBrief } from "./taskBrief.js";
import { CHIEF_TOOLS } from "./tools.js";

export interface ChiefTurn {
  text: string;
  mode: Mode;
  pendingReadback?: string;
  launchedId?: string;
}

export interface PendingQuestion {
  agentId: string;
  agentLabel: string;
  question: string;
  tier1?: string;
}

export class Chief {
  readonly policy: PolicyState;
  readonly desk: DeskItem[] = [];
  quiet = false;
  mode: Mode = "TALK";
  /** Set by the session when a worker asks the driver something. */
  openQuestion: PendingQuestion | null = null;
  lastSpokenTier0: string | null = null;
  lastHeardTs = Date.now();
  private readonly messages: ChatMessage[] = [];
  private readonly policyConfig: PolicyConfig;
  private readonly ledger: JsonlLedger;
  /** Optional read-only GitHub source. Absent = tools answer "not connected". */
  github: GithubPoller | null = null;

  constructor(
    private readonly workers: WorkerProvider,
    private readonly llm: Llm,
    private readonly config: HeraldConfig,
    systemPrompt: string,
  ) {
    this.policy = newPolicyState();
    this.policyConfig = {
      repoAllowlist: config.repoAllowlist,
      maxConcurrent: config.maxConcurrent,
      launchCap: config.launchCap,
      confirmTimeoutMs: config.confirmTimeoutMs,
    };
    this.ledger = new JsonlLedger(join(config.repoRoot, ".herald", "ledger.jsonl"));
    this.messages.push({ role: "system", content: systemPrompt });
  }

  async handleUtterance(text: string, now = Date.now()): Promise<ChiefTurn> {
    const intent = parseIntent(text, { mode: this.mode, pending: this.policy.pending });
    this.ledger.append("user", { text, intent });

    if (this.policy.pending) {
      if (intent.type === "approve") {
        const result = await this.executeApproved(now);
        this.mode = "TALK";
        return { ...result, mode: this.mode };
      }
      if (intent.type === "reject") {
        rejectPending(this.policy);
        this.mode = "TALK";
        return { text: spokenOrFallback("Cancelled."), mode: this.mode };
      }
      if (this.policy.pending.expiresAt <= now) {
        rejectPending(this.policy);
        this.mode = "TALK";
        return {
          text: spokenOrFallback("That confirmation timed out, so I cancelled it."),
          mode: this.mode,
        };
      }
      this.mode = "CONFIRM";
      return {
        text: spokenOrFallback(`I still need a yes or no. ${this.policy.pending.readback}`),
        mode: this.mode,
        pendingReadback: this.policy.pending.readback,
      };
    }

    const handled = await this.handleDeterministic(intent, text, now);
    if (handled) return handled;

    this.messages.push({ role: "user", content: text });
    const spoken = await this.loopLlm(now);
    return spoken;
  }

  /**
   * Intents that must not depend on an LLM: silencing, mode, recap, desk, and
   * relaying an answer to a worker that asked a question.
   */
  private async handleDeterministic(
    intent: ReturnType<typeof parseIntent>,
    text: string,
    now: number,
  ): Promise<ChiefTurn | null> {
    switch (intent.type) {
      case "stop":
      case "back_to_music":
        this.mode = "LISTEN";
        return { text: "", mode: this.mode };
      case "quiet_on":
        this.quiet = true;
        this.mode = "LISTEN";
        return { text: spokenOrFallback("Quiet mode on. Only blockers."), mode: this.mode };
      case "quiet_off":
        this.quiet = false;
        return { text: spokenOrFallback("Quiet mode off."), mode: "TALK" };
      case "parked":
        this.mode = "PARKED";
        return { text: this.driveDigest(), mode: this.mode };
      case "recap": {
        const line = await this.recapLine();
        this.lastHeardTs = now;
        return { text: line, mode: "TALK" };
      }
      case "repeat":
        return {
          text: this.lastSpokenTier0 ?? spokenOrFallback("Nothing to repeat."),
          mode: "TALK",
        };
      case "more":
      case "walkthrough": {
        if (!this.openQuestion?.tier1) return null;
        return { text: spokenOrFallback(this.openQuestion.tier1), mode: "TALK" };
      }
      case "queue_for_desk": {
        const target = this.openQuestion;
        this.desk.push({
          id: crypto.randomUUID(),
          createdAt: now,
          agentId: target?.agentId ?? "chief",
          reason: target ? "long_decision" : "user_deferred",
          note: target?.question ?? "Driver deferred an item.",
          links: {},
          done: false,
        });
        this.openQuestion = null;
        this.ledger.append("desk", { count: this.desk.length });
        return {
          text: spokenOrFallback("Saved for your desk."),
          mode: "TALK",
        };
      }
      case "new_task": {
        const repo = this.policyConfig.repoAllowlist[0];
        if (!repo) {
          return { text: spokenOrFallback("No repo is allowed for voice launches."), mode: "TALK" };
        }
        const brief = buildTaskBrief(intent.text, repo, this.config.startingRef);
        if (brief.questions.length) {
          this.mode = "TALK";
          return { text: spokenOrFallback(brief.questions[0]!), mode: this.mode };
        }
        const req: LaunchRequest = {
          task: brief.prompt,
          repo,
          branch: this.config.startingRef,
          autoCreatePR: true,
        };
        const gate = assertLaunchAllowed(this.policy, this.policyConfig, req);
        if (!gate.ok) return { text: spokenOrFallback(denialMessage(gate)), mode: "TALK" };
        const pending = requestConfirmation(
          this.policy,
          "launch_agent",
          req,
          brief.readback,
          now,
          this.policyConfig.confirmTimeoutMs,
        );
        this.mode = "CONFIRM";
        this.ledger.append("confirm", { readback: pending.readback });
        return {
          text: spokenOrFallback(pending.readback),
          mode: this.mode,
          pendingReadback: pending.readback,
        };
      }
      case "answer": {
        const target = this.openQuestion;
        if (!target) return null;
        await this.workers.followup(target.agentId, text);
        this.openQuestion = null;
        this.ledger.append("followup", { id: target.agentId, message: text });
        return { text: spokenOrFallback("Passed it on."), mode: "TALK" };
      }
      default:
        break;
    }

    // A free-form reply while a worker is waiting is an answer, not a new task.
    if (this.openQuestion && intent.type === "unknown" && text.trim().length > 1) {
      const target = this.openQuestion;
      await this.workers.followup(target.agentId, text);
      this.openQuestion = null;
      this.ledger.append("followup", { id: target.agentId, message: text });
      return { text: spokenOrFallback("Passed it on."), mode: "TALK" };
    }

    return null;
  }

  private async recapLine(): Promise<string> {
    const agents = await this.workers.list();
    const needsYou = this.openQuestion ? 1 : 0;
    const done = agents.filter((a) => a.runStatus === "FINISHED").length;
    const running = agents.filter((a) => a.runStatus === "RUNNING" || a.agentStatus === "ACTIVE").length;
    const parts: string[] = [];
    if (needsYou) parts.push("one needs your call");
    if (done) parts.push(`${spell(done)} finished`);
    if (running) parts.push(`${spell(running)} still working`);
    if (!parts.length) return spokenOrFallback("Nothing's running.");
    return spokenOrFallback(`${capitalize(parts.join(", "))}.`);
  }

  private driveDigest(): string {
    const deskCount = this.desk.filter((d) => !d.done).length;
    const tail = deskCount
      ? `${capitalize(spell(deskCount))} ${deskCount === 1 ? "item" : "items"} saved for your desk.`
      : "Nothing saved for your desk.";
    return spokenOrFallback(`Welcome back. ${tail}`);
  }

  private async loopLlm(now: number): Promise<ChiefTurn> {
    for (let i = 0; i < 6; i++) {
      const result = await this.llm.complete(this.messages, CHIEF_TOOLS);
      if (!result.toolCalls.length) {
        const text = spokenOrFallback(result.content || "Okay.");
        this.messages.push({ role: "assistant", content: text });
        this.ledger.append("chief", { text });
        return { text, mode: this.mode, pendingReadback: this.policy.pending?.readback };
      }

      this.messages.push({
        role: "assistant",
        content: result.content || "",
        tool_calls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        const toolResult = await this.dispatchTool(call.function.name, call.function.arguments, now);
        this.messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        });
        if (toolResult && typeof toolResult === "object" && "needsConfirm" in toolResult && toolResult.needsConfirm) {
          this.mode = "CONFIRM";
          const readback = String((toolResult as { readback: string }).readback);
          const text = spokenOrFallback(readback);
          this.ledger.append("confirm", { readback });
          return { text, mode: this.mode, pendingReadback: readback };
        }
        if (toolResult && typeof toolResult === "object" && "launched" in toolResult) {
          const launchedId = String((toolResult as { id: string }).id);
          const text = spokenOrFallback("The agent is running. I'll cut in if it needs you.");
          this.mode = "TALK";
          return { text, mode: this.mode, launchedId };
        }
      }
    }
    return { text: spokenOrFallback("I lost the thread. Try that again."), mode: this.mode };
  }

  private async executeApproved(now: number): Promise<ChiefTurn> {
    const approved = approvePending(this.policy, now);
    if (!approved.ok) {
      return { text: spokenOrFallback(denialMessage(approved)), mode: this.mode };
    }
    const { pending } = approved;
    if (pending.tool === "launch_agent") {
      const req = pending.args as LaunchRequest;
      const gate = assertLaunchAllowed(this.policy, this.policyConfig, req);
      if (!gate.ok) return { text: spokenOrFallback(denialMessage(gate)), mode: this.mode };
      const handle = await this.workers.launch(req);
      recordLaunch(this.policy, handle.id);
      this.ledger.append("launch", { id: handle.id, req });
      return {
        text: spokenOrFallback("The agent is running. I'll cut in if it needs you."),
        mode: this.mode,
        launchedId: handle.id,
      };
    }
    if (pending.tool === "stop_agent") {
      const { id } = pending.args as { id: string };
      await this.workers.stop(id);
      recordStop(this.policy, id);
      this.ledger.append("stop", { id });
      return { text: spokenOrFallback("Stopped."), mode: this.mode };
    }
    if (pending.tool === "followup_agent") {
      const { id, message } = pending.args as { id: string; message: string };
      await this.workers.followup(id, message);
      this.ledger.append("followup", { id, message });
      return { text: spokenOrFallback("Sent."), mode: this.mode };
    }
    return { text: spokenOrFallback("I couldn't complete that."), mode: this.mode };
  }

  private async dispatchTool(name: string, rawArgs: string, now: number): Promise<Record<string, unknown>> {
    if (FORBIDDEN_TOOLS.has(name)) {
      return { error: "That action is not available by voice. I've saved it for your desk." };
    }
    let args: Record<string, unknown> = {};
    try {
      args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch {
      return { error: "I couldn't parse that tool call." };
    }

    switch (name) {
      case "list_agents": {
        const items = await this.workers.list();
        return {
          agents: items.map((a) => ({
            id: a.id,
            label: a.label,
            status: a.agentStatus,
            run: a.runStatus,
            headline: a.headline,
          })),
        };
      }
      case "get_agent_status": {
        try {
          const status = await this.workers.status(String(args.id));
          return {
            status: status.agentStatus,
            run: status.runStatus,
            headline: spokenOrFallback(status.headline ?? status.label, status.label),
          };
        } catch (err) {
          return { error: spokenOrFallback("I couldn't reach that agent."), detail: String(err) };
        }
      }
      case "get_briefing": {
        try {
          const status = await this.workers.status(String(args.id));
          const tier = Number(args.tier) as 0 | 1 | 2;
          const raw = status.headline ?? status.result ?? "No update yet.";
          const line = spokenOrFallback(raw, status.label);
          return { tier, script: line };
        } catch {
          return { tier: 0, script: spokenOrFallback("No update yet.") };
        }
      }
      case "launch_agent": {
        const req: LaunchRequest = {
          task: String(args.task ?? ""),
          repo: String(args.repo ?? ""),
          branch: args.branch ? String(args.branch) : this.config.startingRef,
        };
        const gate = assertLaunchAllowed(this.policy, this.policyConfig, req);
        if (!gate.ok) return { error: denialMessage(gate) };
        if (!TOOLS_REQUIRING_CONFIRM.has("launch_agent")) {
          return { error: "internal policy error" };
        }
        const pending = requestConfirmation(
          this.policy,
          "launch_agent",
          req,
          readbackForLaunch(req),
          now,
          this.policyConfig.confirmTimeoutMs,
        );
        return { needsConfirm: true, readback: pending.readback };
      }
      case "followup_agent": {
        const id = String(args.id);
        const message = String(args.message);
        if (args.changesScope) {
          const pending = requestConfirmation(
            this.policy,
            "followup_agent",
            { id, message },
            `I'll send that follow-up. Go ahead?`,
            now,
            this.policyConfig.confirmTimeoutMs,
          );
          return { needsConfirm: true, readback: pending.readback };
        }
        await this.workers.followup(id, message);
        return { sent: true };
      }
      case "stop_agent": {
        const id = String(args.id);
        const pending = requestConfirmation(
          this.policy,
          "stop_agent",
          { id },
          readbackForStop(id),
          now,
          this.policyConfig.confirmTimeoutMs,
        );
        return { needsConfirm: true, readback: pending.readback };
      }
      case "recap": {
        const items = await this.workers.list();
        if (!items.length) return { recap: "Nothing's running." };
        const line = items
          .slice(0, 3)
          .map((a) => a.label)
          .join(", ");
        return { recap: spokenOrFallback(`On the board: ${line}.`) };
      }
      case "github_my_queue": {
        const prs = await this.githubSnapshot();
        if (!prs) return { error: spokenOrFallback("I can't reach GitHub right now. Try again in a minute.") };
        const q = summarizeQueue(prs);
        return { queue: q, headline: queueHeadline(q) };
      }
      case "github_pr_status": {
        const prs = await this.githubSnapshot();
        if (!prs) return { error: spokenOrFallback("I can't reach GitHub right now. Try again in a minute.") };
        const pr = prs.find((p) => p.number === Number(args.number));
        if (!pr) return { error: spokenOrFallback("I don't see that pull request.") };
        return { headline: prStatusHeadline(pr) };
      }
      case "queue_for_desk": {
        const item: DeskItem = {
          id: crypto.randomUUID(),
          createdAt: now,
          agentId: "chief",
          reason: "user_deferred",
          note: String(args.note ?? args.item ?? ""),
          links: {},
          done: false,
        };
        this.desk.push(item);
        this.ledger.append("desk", item);
        return { queued: true };
      }
      case "set_quiet_mode": {
        this.quiet = Boolean(args.on);
        return { quiet: this.quiet };
      }
      case "set_mode": {
        const mode = args.mode === "LISTEN" ? "LISTEN" : "TALK";
        this.mode = mode;
        return { mode };
      }
      default:
        return { error: "Unknown tool." };
    }
  }

  /** Last good GitHub snapshot from the poller; null if not connected or unreachable. */
  private async githubSnapshot() {
    const gh = this.github;
    if (!gh) return null;
    if (!gh.ready) await gh.tick();
    return gh.ready ? gh.latest : null;
  }
}

function spell(n: number): string {
  const words = ["none", "one", "two", "three", "four", "five", "six"];
  return words[n] ?? String(n);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
