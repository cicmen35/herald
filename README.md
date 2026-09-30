# Herald

Voice-first layer for Cursor agents while driving. Placeholder name; see `packages/core/src/brand.ts`.

**Safety:** demo parked, on a simulator, or with a phone and headphones. Follow local laws. The car UI is a status light and one big button.

## Setup

```bash
pnpm install
cp .env.example .env   # then add keys
pnpm test
```

## Keys (server only, never the phone)

- `CURSOR_API_KEY` — Cursor dashboard API key (Cloud Agents).
- `HERALD_TEST_REPO` — GitHub URL the key can launch agents against.
- `GITHUB_MCP_TOKEN` — fine-grained, **read-only** GitHub token for the demo repo (Contents, Pull requests, Issues, Actions: read). Repo comes from `HERALD_TEST_REPO`.
- `OPENAI_API_KEY` — Chief LLM (recommended default). Omit and use `pnpm chief:mock`.

## Commands

| Command | What |
|---|---|
| `pnpm spike:cloud` | M0: launch, poll, conversation, follow-up, stop a Cloud Agent |
| `pnpm spike:hook` | M0: write a synthetic hook payload to `.herald/raw/` |
| `pnpm spike:voice` | M0: phone PWA at http://127.0.0.1:8787 (use HTTPS tunnel on device) |
| `pnpm spike:github` | M0: connect to the read-only GitHub MCP, list tools, dump raw payloads to `.herald/raw/mcp/` |
| `pnpm chief:mock` | M1: headless Chief, mock workers |
| `pnpm chief` | M1: Chief against Cloud Agents |

## M1 acceptance (terminal)

```text
pnpm chief:mock
> start an agent to add a health-check endpoint
[CONFIRM] I'll start an agent to add a health-check endpoint on main, with tests, and open a pull request. Go ahead?
> yes
[TALK] The agent is running. I'll cut in if it needs you.
```

## GitHub (read-only)

The Chief can answer "what's waiting on me?" and cut in when checks go red on your PRs, a review is requested, or a PR merges. It cannot merge, review, comment, or change anything: the server only ever calls an allowlist of read tools (`packages/server/src/connectors/github.ts`), and spoken lines are built from counts and PR numbers, never PR titles or bodies. Without `GITHUB_MCP_TOKEN` + `HERALD_TEST_REPO`, `pnpm car` runs a mock (demo triggers: POST `/api/sim` `{"scenario":"gh_ci_fail" | "gh_review" | "gh_merged" | "gh_changes"}`). Settings: `GITHUB_MCP_URL`, `HERALD_GITHUB_POLL_MS` (default 45000).

## Privacy

The server should send headlines, diff stats, and short excerpts to LLM/STT/TTS providers — not whole files or secrets. Cloud API keys stay on the server.
