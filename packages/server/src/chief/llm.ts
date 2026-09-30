import { spokenOrFallback } from "@herald/core";
import type { HeraldConfig } from "../config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmResult {
  content: string;
  toolCalls: ToolCall[];
}

export interface Llm {
  complete(messages: ChatMessage[], tools: unknown[]): Promise<LlmResult>;
}

interface OpenAiChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  };
}

export class OpenAiLlm implements Llm {
  constructor(private readonly config: HeraldConfig) {}

  async complete(messages: ChatMessage[], tools: unknown[]): Promise<LlmResult> {
    const res = await fetch(`${this.config.llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.llmModel,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LLM ${res.status}: ${body.slice(0, 400)}`);
    }
    const json = (await res.json()) as { choices?: OpenAiChoice[] };
    const msg = json.choices?.[0]?.message;
    return {
      content: msg?.content ?? "",
      toolCalls: (msg?.tool_calls ?? []).map((c) => ({
        id: c.id,
        type: "function" as const,
        function: c.function,
      })),
    };
  }
}

/** Deterministic Chief for CLI/tests when no LLM key is present. */
export class ScriptedLlm implements Llm {
  constructor(private readonly defaultRepo: string) {}

  async complete(messages: ChatMessage[], _tools: unknown[]): Promise<LlmResult> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const lastTool = [...messages].reverse().find((m) => m.role === "tool");

    if (lastTool) {
      const parsed = safeJson(lastTool.content);
      if (parsed && parsed.needsConfirm) {
        return { content: String(parsed.readback ?? "Go ahead?"), toolCalls: [] };
      }
      if (parsed && parsed.launched) {
        return {
          content: spokenOrFallback("The agent is running. I'll cut in if it needs you."),
          toolCalls: [],
        };
      }
      if (parsed && typeof parsed.headline === "string" && !parsed.status) {
        return { content: spokenOrFallback(parsed.headline), toolCalls: [] };
      }
      if (parsed && parsed.status) {
        const headline = String(parsed.headline ?? parsed.status);
        return { content: spokenOrFallback(headline), toolCalls: [] };
      }
      if (parsed && parsed.error) {
        return { content: spokenOrFallback(String(parsed.error)), toolCalls: [] };
      }
      return { content: spokenOrFallback("Done."), toolCalls: [] };
    }

    if (/health-?check/i.test(lastUser) && /(start|launch|add|agent)/i.test(lastUser)) {
      return {
        content: "",
        toolCalls: [
          {
            id: "call-launch",
            type: "function",
            function: {
              name: "launch_agent",
              arguments: JSON.stringify({
                task: "add a health-check endpoint",
                repo: this.defaultRepo,
              }),
            },
          },
        ],
      };
    }

    if (/pull request|\bPRs?\b|review|\bci\b|checks|what's waiting|whats waiting/i.test(lastUser)) {
      const n = lastUser.match(/(?:pull request|PR)\s*#?(\d+)/i);
      return {
        content: "",
        toolCalls: [
          {
            id: "call-gh",
            type: "function",
            function: n
              ? { name: "github_pr_status", arguments: JSON.stringify({ number: Number(n[1]) }) }
              : { name: "github_my_queue", arguments: "{}" },
          },
        ],
      };
    }

    if (/status|how's it going|how is it going|list agents/i.test(lastUser)) {
      return {
        content: "",
        toolCalls: [
          {
            id: "call-list",
            type: "function",
            function: { name: "list_agents", arguments: "{}" },
          },
        ],
      };
    }

    return {
      content: spokenOrFallback("I didn't catch a task. Try: start an agent to add a health-check endpoint."),
      toolCalls: [],
    };
  }
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
