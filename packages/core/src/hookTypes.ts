/** Observed Cursor hook stdin (Cursor 3.22.12, 2026-09-30). Written from dumps in `.herald/raw/`, not docs guesses. */

export interface HookEnvelope {
  conversation_id: string;
  generation_id: string;
  session_id: string;
  hook_event_name: string;
  cursor_version: string;
  workspace_roots: string[];
  transcript_path?: string;
  user_email?: string;
  model?: string;
  model_id?: string;
  model_params?: { id: string; value: string }[];
}

export interface AfterFileEditHook extends HookEnvelope {
  hook_event_name: "afterFileEdit";
  file_path: string;
  edits: { old_string: string; new_string: string }[];
}

export interface PreToolUseHook extends HookEnvelope {
  hook_event_name: "preToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_use_id?: string;
}

export interface PostToolUseHook extends HookEnvelope {
  hook_event_name: "postToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_output?: string;
  duration?: number;
  tool_use_id?: string;
}

export interface AfterAgentThoughtHook extends HookEnvelope {
  hook_event_name: "afterAgentThought";
  text: string;
  duration_ms?: number;
}

export interface StopHook extends HookEnvelope {
  hook_event_name: "stop";
  status?: string;
  loop_count?: number;
}

export interface BeforeMcpHook extends HookEnvelope {
  hook_event_name: "beforeMCPExecution";
  tool_name: string;
  /** Observed as a JSON string, not an object. */
  tool_input: string;
  mcp_server_name: string;
  command?: string;
}

export interface AfterMcpHook extends HookEnvelope {
  hook_event_name: "afterMCPExecution";
  tool_name: string;
  tool_input: string;
  result_json?: string;
  duration?: number;
  mcp_server_name: string;
}

export interface BeforeSubmitPromptHook extends HookEnvelope {
  hook_event_name: "beforeSubmitPrompt";
  composer_mode?: string;
  prompt: string;
  attachments?: { type: string; file_path?: string }[];
}

export type ObservedHook =
  | AfterFileEditHook
  | PreToolUseHook
  | PostToolUseHook
  | AfterAgentThoughtHook
  | StopHook
  | BeforeMcpHook
  | AfterMcpHook
  | BeforeSubmitPromptHook
  | (HookEnvelope & { hook_event_name: string });
