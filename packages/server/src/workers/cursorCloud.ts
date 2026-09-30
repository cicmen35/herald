import type { ConversationTurn, LaunchRequest, WorkerHandle, WorkerStatus } from "@herald/core";
import type { WorkerProvider } from "./types.js";

const API = "https://api.cursor.com";

export interface CursorCloudOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export class CursorApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export class CursorCloudProvider implements WorkerProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CursorCloudOptions) {
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async launch(req: LaunchRequest): Promise<WorkerHandle> {
    const body = {
      prompt: {
        text: `${req.task}

Constraints: open a pull request; do not merge. Add tests. Do not deploy or delete anything.`,
      },
      name: req.task.slice(0, 100),
      repos: [{ url: req.repo, startingRef: req.branch ?? "main" }],
      autoCreatePR: req.autoCreatePR ?? true,
      skipReviewerRequest: true,
    };
    const json = await this.request("POST", "/v1/agents", body);
    const agent = json.agent as Record<string, unknown>;
    return {
      id: String(agent.id),
      label: String(agent.name ?? req.task),
      url: typeof agent.url === "string" ? agent.url : undefined,
      latestRunId: typeof agent.latestRunId === "string" ? agent.latestRunId : undefined,
    };
  }

  async list(): Promise<WorkerStatus[]> {
    const json = await this.request("GET", "/v1/agents?limit=20&includeArchived=false");
    const items = (json.items as Record<string, unknown>[]) ?? [];
    return items.map((a) => this.toStatus(a));
  }

  async status(id: string): Promise<WorkerStatus> {
    const agent = await this.request("GET", `/v1/agents/${id}`);
    const base = this.toStatus(agent);
    if (base.latestRunId) {
      try {
        const run = await this.request("GET", `/v1/agents/${id}/runs/${base.latestRunId}`);
        base.runStatus = String(run.status ?? "");
        if (typeof run.result === "string") {
          base.result = run.result;
          base.headline = run.result.slice(0, 180);
        }
      } catch {
        // run lookup is best-effort
      }
    }
    return base;
  }

  async conversation(id: string): Promise<ConversationTurn[]> {
    const json = await this.request("GET", `/v1/agents/${id}/runs?limit=20`);
    const items = (json.items as Record<string, unknown>[]) ?? [];
    const turns: ConversationTurn[] = [];
    for (const item of items) {
      const runId = String(item.id);
      try {
        const run = await this.request("GET", `/v1/agents/${id}/runs/${runId}`);
        turns.push({
          runId,
          status: String(run.status ?? item.status ?? ""),
          result: typeof run.result === "string" ? run.result : undefined,
          createdAt: typeof run.createdAt === "string" ? run.createdAt : undefined,
        });
      } catch {
        turns.push({
          runId,
          status: String(item.status ?? ""),
        });
      }
    }
    return turns;
  }

  async followup(id: string, message: string): Promise<{ runId: string }> {
    const json = await this.request("POST", `/v1/agents/${id}/runs`, {
      prompt: { text: message },
    });
    const run = json.run as Record<string, unknown>;
    return { runId: String(run.id) };
  }

  async stop(id: string): Promise<void> {
    const agent = await this.request("GET", `/v1/agents/${id}`);
    const latestRunId = typeof agent.latestRunId === "string" ? agent.latestRunId : undefined;
    if (latestRunId) {
      try {
        await this.request("POST", `/v1/agents/${id}/runs/${latestRunId}/cancel`);
      } catch (err) {
        if (!(err instanceof CursorApiError) || err.status !== 409) throw err;
      }
    }
    await this.request("POST", `/v1/agents/${id}/archive`);
  }

  private toStatus(agent: Record<string, unknown>): WorkerStatus {
    return {
      id: String(agent.id),
      label: String(agent.name ?? agent.id),
      agentStatus: String(agent.status ?? ""),
      url: typeof agent.url === "string" ? agent.url : undefined,
      latestRunId: typeof agent.latestRunId === "string" ? agent.latestRunId : undefined,
    };
  }

  private async request(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new CursorApiError(`Cursor API ${method} ${path} -> ${res.status}`, res.status, text);
    }
    if (!text) return {};
    return JSON.parse(text) as Record<string, unknown>;
  }
}
