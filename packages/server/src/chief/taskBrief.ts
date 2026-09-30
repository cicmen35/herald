import type { LaunchRequest } from "@herald/core";

export interface TaskBrief {
  prompt: string;
  readback: string;
  questions: string[];
}

const LAUNCH_PREFIX = /^(start|launch|spin up|kick off)\s+(an?\s+)?(agent|task)?\s*(to|that|which)?\s*/i;
const DESTRUCTIVE = /\b(merge|deploy|delete|drop|force[- ]push|truncate|wipe)\b/i;

/**
 * Turns a spoken request into a worker prompt without needing an LLM, so the
 * demo works with no API key. The LLM path can replace this when keyed.
 */
export function buildTaskBrief(spoken: string, repo: string, branch?: string): TaskBrief {
  const task = spoken.replace(LAUNCH_PREFIX, "").replace(/[.!?]+$/, "").trim();

  if (!task || task.split(/\s+/).length < 2) {
    return {
      prompt: "",
      readback: "",
      questions: ["What should the agent work on?"],
    };
  }

  if (DESTRUCTIVE.test(task)) {
    return {
      prompt: "",
      readback: "",
      questions: ["I can't merge, deploy, or delete from the car. Want that saved for your desk?"],
    };
  }

  const prompt = [
    `Task: ${task}.`,
    "",
    "Constraints:",
    "- Add or update tests that prove the change works.",
    "- Keep the change focused; do not refactor unrelated code.",
    "- Open a pull request; do not merge.",
    "- Do not deploy, delete data, or force-push.",
    "",
    "Acceptance criteria:",
    "- The test suite passes.",
    "- The pull request description explains the change in plain language.",
  ].join("\n");

  return {
    prompt,
    readback: `I'll start an agent to ${task}, with tests, and open a pull request. Go ahead?`,
    questions: [],
  };
}

export function launchRequestFrom(brief: TaskBrief, task: string, repo: string, branch?: string): LaunchRequest {
  return { task: brief.prompt || task, repo, branch, autoCreatePR: true };
}
