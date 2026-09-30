import type { CiState, GithubConnector, PrSummary } from "./github.js";
import type { ToolCaller } from "./mcpClient.js";

type Json = Record<string, unknown>;

/** Branches opened by Cursor Cloud Agents; treated as "mine" like the user's own PRs. */
const AGENT_BRANCH_PREFIX = "cursor/";
/** Deep reads (checks, reviews) are capped so one poll stays fast and under rate limits. */
const MAX_DEEP = 5;

function asArray(value: unknown, ...keys: string[]): Json[] {
  if (Array.isArray(value)) return value as Json[];
  if (value && typeof value === "object") {
    for (const k of keys) {
      const v = (value as Json)[k];
      if (Array.isArray(v)) return v as Json[];
    }
  }
  return [];
}
const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});

/** Read-only GitHub via MCP. Only calls tools in GITHUB_READ_TOOLS (enforced by the client). */
export class GithubMcpConnector implements GithubConnector {
  private me: string | null = null;

  constructor(
    private readonly mcp: ToolCaller,
    private readonly repos: string[],
  ) {}

  async snapshot(): Promise<PrSummary[]> {
    const me = await this.login();
    const all: PrSummary[] = [];
    for (const repo of this.repos) all.push(...(await this.repoSnapshot(repo, me)));
    return all;
  }

  private async login(): Promise<string> {
    if (this.me) return this.me;
    const res = obj(await this.mcp.callTool("get_me"));
    this.me = str(res.login);
    return this.me;
  }

  private async repoSnapshot(repo: string, me: string): Promise<PrSummary[]> {
    const [owner, name] = repo.split("/") as [string, string];
    const [open, closed, asked] = await Promise.all([
      this.mcp.callTool("list_pull_requests", { owner, repo: name, state: "open", perPage: 20 }),
      this.mcp.callTool("list_pull_requests", { owner, repo: name, state: "closed", sort: "updated", direction: "desc", perPage: 5 }),
      this.mcp
        .callTool("search_pull_requests", { query: `repo:${repo} is:open review-requested:@me`, perPage: 20 })
        .catch(() => null),
    ]);

    const askedNumbers = new Set(asArray(asked, "items", "pull_requests").map((p) => Number(p.number)));
    const prs: PrSummary[] = [
      ...asArray(open, "pull_requests", "items"),
      ...asArray(closed, "pull_requests", "items"),
    ].map((raw) => this.toSummary(raw, me, askedNumbers));

    // Checks and reviews only for the PRs worth interrupting for.
    const deep = prs.filter((p) => p.state === "open" && p.mine).slice(0, MAX_DEEP);
    await Promise.all(
      deep.map(async (pr) => {
        const [checks, reviews] = await Promise.all([
          this.mcp.callTool("pull_request_read", { method: "get_check_runs", owner, repo: name, pullNumber: pr.number }).catch(() => null),
          this.mcp.callTool("pull_request_read", { method: "get_reviews", owner, repo: name, pullNumber: pr.number }).catch(() => null),
        ]);
        pr.ci = checks ? ciFrom(asArray(checks, "check_runs", "checkRuns", "items")) : "none";
        const r = reviewCounts(asArray(reviews, "reviews", "items"));
        pr.approvals = r.approvals;
        pr.changesRequested = r.changesRequested;
      }),
    );
    return prs;
  }

  private toSummary(raw: Json, me: string, asked: Set<number>): PrSummary {
    const number = Number(raw.number);
    const head = obj(raw.head);
    const branch = str(head.ref) || str(raw.headRefName);
    const author = str(obj(raw.user).login) || str(obj(raw.author).login);
    const merged = raw.merged === true || Boolean(str(raw.merged_at));
    const state = merged ? "merged" : str(raw.state).toLowerCase() === "closed" ? "closed" : "open";
    return {
      number,
      title: str(raw.title),
      url: str(raw.html_url) || str(raw.url),
      branch,
      author,
      state,
      draft: raw.draft === true,
      reviewRequested: asked.has(number),
      mine: (Boolean(me) && author === me) || branch.startsWith(AGENT_BRANCH_PREFIX),
      ci: "none",
      approvals: 0,
      changesRequested: 0,
    };
  }
}

export function ciFrom(runs: Json[]): CiState {
  if (!runs.length) return "none";
  const bad = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);
  let pending = false;
  for (const r of runs) {
    const conclusion = str(r.conclusion).toLowerCase();
    if (bad.has(conclusion)) return "failing";
    if (str(r.status).toLowerCase() !== "completed") pending = true;
  }
  return pending ? "pending" : "passing";
}

/** Latest review per person wins. */
export function reviewCounts(reviews: Json[]): { approvals: number; changesRequested: number } {
  const latest = new Map<string, string>();
  for (const r of reviews) {
    const who = str(obj(r.user).login) || str(r.id);
    const state = str(r.state).toUpperCase();
    if (state === "APPROVED" || state === "CHANGES_REQUESTED" || state === "DISMISSED") latest.set(who, state);
  }
  const states = [...latest.values()];
  return {
    approvals: states.filter((s) => s === "APPROVED").length,
    changesRequested: states.filter((s) => s === "CHANGES_REQUESTED").length,
  };
}
