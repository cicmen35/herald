import type { ConversationTurn, LaunchRequest, WorkerHandle, WorkerStatus } from "@herald/core";
import type { WorkerProvider } from "./types.js";

interface MockAgent {
  id: string;
  label: string;
  agentStatus: string;
  runStatus: string;
  result: string;
  turns: ConversationTurn[];
}

export class MockWorkerProvider implements WorkerProvider {
  readonly launched: LaunchRequest[] = [];
  readonly followups: { id: string; message: string }[] = [];
  readonly stopped: string[] = [];
  private agents = new Map<string, MockAgent>();
  private seq = 0;

  async launch(req: LaunchRequest): Promise<WorkerHandle> {
    this.seq += 1;
    const id = `mock-${this.seq}`;
    const runId = `run-mock-${this.seq}`;
    const agent: MockAgent = {
      id,
      label: req.task.slice(0, 60),
      agentStatus: "IDLE",
      runStatus: "FINISHED",
      result: "Added a health-check endpoint. Tests pass. Opened a pull request. Did not merge.",
      turns: [
        {
          runId,
          status: "FINISHED",
          result: "Added a health-check endpoint. Tests pass. Opened a pull request. Did not merge.",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    this.agents.set(id, agent);
    this.launched.push(req);
    return { id, label: agent.label, latestRunId: runId };
  }

  async list(): Promise<WorkerStatus[]> {
    return [...this.agents.values()].map((a) => this.toStatus(a));
  }

  async status(id: string): Promise<WorkerStatus> {
    const a = this.agents.get(id);
    if (!a) {
      return {
        id,
        label: "Unknown agent",
        agentStatus: "IDLE",
        headline: "No update yet.",
      };
    }
    return this.toStatus(a);
  }

  async conversation(id: string): Promise<ConversationTurn[]> {
    return this.require(id).turns;
  }

  async followup(id: string, message: string): Promise<{ runId: string }> {
    const a = this.require(id);
    const runId = `run-mock-fu-${a.turns.length + 1}`;
    a.turns.unshift({ runId, status: "FINISHED", result: `Follow-up noted: ${message.slice(0, 80)}` });
    this.followups.push({ id, message });
    return { runId };
  }

  async stop(id: string): Promise<void> {
    const a = this.require(id);
    a.agentStatus = "ARCHIVED";
    a.runStatus = "CANCELLED";
    this.stopped.push(id);
  }

  private require(id: string): MockAgent {
    const a = this.agents.get(id);
    if (!a) throw new Error(`unknown agent ${id}`);
    return a;
  }

  private toStatus(a: MockAgent): WorkerStatus {
    return {
      id: a.id,
      label: a.label,
      agentStatus: a.agentStatus,
      runStatus: a.runStatus,
      headline: a.result.slice(0, 180),
      result: a.result,
    };
  }
}
