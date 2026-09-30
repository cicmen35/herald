export const CHIEF_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_agents",
      description: "List active and finished worker agents with a short label and state.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_agent_status",
      description: "State plus the latest headline for one worker.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_briefing",
      description: "Sanitised spoken script at tier 0, 1, or 2.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          tier: { type: "integer", enum: [0, 1, 2] },
        },
        required: ["id", "tier"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "launch_agent",
      description: "Launch a cloud worker. Requires spoken confirmation before it actually starts.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string" },
          repo: { type: "string" },
          branch: { type: "string" },
        },
        required: ["task", "repo"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "followup_agent",
      description: "Send a follow-up or answer a decision. Confirm if it changes scope.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          message: { type: "string" },
          changesScope: { type: "boolean" },
        },
        required: ["id", "message"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "stop_agent",
      description: "Stop a worker. Requires spoken confirmation.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "recap",
      description: "What did I miss across agents.",
      parameters: {
        type: "object",
        properties: { since: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "queue_for_desk",
      description: "Save something for visual review at the desk.",
      parameters: {
        type: "object",
        properties: {
          item: { type: "string" },
          note: { type: "string" },
        },
        required: ["item", "note"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_quiet_mode",
      description: "Downgrade everything except blockers.",
      parameters: {
        type: "object",
        properties: { on: { type: "boolean" } },
        required: ["on"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_mode",
      description: "Switch LISTEN or TALK, e.g. back to music.",
      parameters: {
        type: "object",
        properties: { mode: { type: "string", enum: ["LISTEN", "TALK"] } },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "github_my_queue",
      description:
        "Read-only. Counts of pull requests waiting for the driver's review, the driver's PRs with failing checks, and PRs with requested changes. Use for 'what's waiting on me', 'any PRs', 'is CI green'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "github_pr_status",
      description: "Read-only. Spoken status of one pull request by number: state, checks, reviews.",
      parameters: {
        type: "object",
        properties: { number: { type: "integer" } },
        required: ["number"],
        additionalProperties: false,
      },
    },
  },
];
