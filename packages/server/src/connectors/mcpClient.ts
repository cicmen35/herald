import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** Raised when something asks for a tool that is not on the connector allowlist. */
export class ToolNotAllowedError extends Error {
  constructor(readonly tool: string) {
    super(`MCP tool not allowed: ${tool}`);
  }
}

export class McpTimeoutError extends Error {
  constructor(readonly tool: string, readonly ms: number) {
    super(`MCP tool timed out after ${ms}ms: ${tool}`);
  }
}

/** The one method connectors need. Lets tests and mocks stand in for a real server. */
export interface ToolCaller {
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface McpClientOptions {
  url: string;
  token: string;
  /** Deny by default: only these tool names can ever be called. */
  allowedTools: readonly string[];
  timeoutMs?: number;
  /** Called with every raw result. Used by the spike to record real payloads. */
  onRaw?: (tool: string, args: unknown, raw: unknown) => void;
}

/**
 * Thin wrapper over the MCP SDK (Streamable HTTP). Enforces the tool allowlist
 * and a timeout in code, so a prompt or a server change cannot widen access.
 */
export class McpClient implements ToolCaller {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private readonly allowed: Set<string>;
  private readonly timeoutMs: number;

  constructor(private readonly opts: McpClientOptions) {
    this.allowed = new Set(opts.allowedTools);
    this.timeoutMs = opts.timeoutMs ?? 4_000;
  }

  isAllowed(tool: string): boolean {
    return this.allowed.has(tool);
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = (async () => {
        const transport = new StreamableHTTPClientTransport(new URL(this.opts.url), {
          requestInit: { headers: { Authorization: `Bearer ${this.opts.token}` } },
        });
        const client = new Client({ name: "herald", version: "0.0.1" });
        await client.connect(transport);
        this.client = client;
        return client;
      })().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  /** Tool names the server offers. Diagnostic only; nothing here widens the allowlist. */
  async listToolNames(): Promise<string[]> {
    const client = await this.connect();
    const res = await client.listTools();
    return res.tools.map((t) => t.name);
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.allowed.has(name)) throw new ToolNotAllowedError(name);
    const client = await this.connect();
    const call = client.callTool({ name, arguments: args });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new McpTimeoutError(name, this.timeoutMs)), this.timeoutMs);
    });
    try {
      const result = await Promise.race([call, timeout]);
      this.opts.onRaw?.(name, args, result);
      return unwrapToolResult(result);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => undefined);
    this.client = null;
  }
}

/** MCP tool results are `{ content: [{type:"text", text}] , isError? }`. Text is usually JSON. */
export function unwrapToolResult(result: unknown): unknown {
  const r = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  const text = (r.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n");
  if (r.isError) throw new Error(`MCP tool error: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
