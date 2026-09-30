import type { AgentEvent, Priority } from "./types.js";

export function triagePriority(event: AgentEvent): Priority {
  if (
    event.kind === "needs_decision" ||
    event.kind === "blocked" ||
    event.kind === "tests_failed" ||
    event.kind === "error" ||
    event.risk === "high"
  ) {
    return "interrupt";
  }
  if (event.kind === "finished") return "speak";
  if (event.kind === "progress" && event.headline) return "speak";
  if (event.kind === "file_edit" || event.kind === "started") return "earcon";
  return "silent";
}
