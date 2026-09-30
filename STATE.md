# STATE

## Current milestone: M1 done (mock); M0 cloud/phone still need you

## Done

- Read `AGENTS.md`. Scaffolded pnpm workspaces (`@herald/core`, `@herald/server`), prompts, logging hook, voice spike PWA, headless Chief + confirmation policy.
- Unit tests: sanitiser, intents, triage, policy, Chief confirm/timeout, hook→event mapping (18 tests).
- Cursor Cloud **v1** client from live docs (2026-09-30). Isolated in `packages/server/src/workers/cursorCloud.ts`.
- Logging hook installed; **real local-agent payloads** dumped to `.herald/raw/` during this session (Cursor 3.22.12). Types in `packages/core/src/hookTypes.ts` from those dumps.
- M1 acceptance on mock workers: `start an agent to add a health-check endpoint` → read-back → `yes` → `launched mock-1`.
- Voice spike UI loads; demo track + Media Session handlers attach; `speechSynthesis` first-audio **260ms** in the Cursor embedded browser; Web Audio oscillator start **0ms**.

- **GitHub connector (read-only MCP), Slack dropped (no time).** `packages/server/src/connectors/`: `mcpClient.ts` (SDK wrapper, deny-by-default tool allowlist, 4s timeout), `github.ts` (types, mock, pure `diffPrs`, spoken headlines from counts only), `githubMcp.ts` (real MCP-backed snapshot), `githubPoller.ts` (drain: silent baseline, backoff). Chief tools `github_my_queue`, `github_pr_status`. GitHub events reuse triage/sanitiser; PRs land in the Desk queue with links. 38 server tests (25 new: write tools refused, PR text never spoken, injection launches nothing).
- Live spike (`pnpm spike:github`): connect + `listTools` **1.8s**, `get_me` **0.65s**. `/mcp/readonly` offers **27 tools, 0 write-capable**. PR/CI reads **not yet run** (no repo configured).

- **Fixed: the big button got stuck in TALK and a press read as "stop listening".** `apps/car-client/app.js` set `mode = "TALK"` and then let every failure path leave it there with no microphone open. Rewrote the mic/button state machine (details under Discoveries).

## In progress

- Live Cloud Agent spike (`pnpm spike:cloud`) — still no `CURSOR_API_KEY` / `HERALD_TEST_REPO`.
- Phone + Bluetooth + headset play/pause as PTT — not run on a real device.

## Next (ordered)

0. GitHub: open one PR on `cicmen35/car_wash_booking` (with any check) and run `pnpm car` to see a real end-to-end event.

1. You: drop `CURSOR_API_KEY` + `HERALD_TEST_REPO` in `.env`, then `pnpm spike:cloud`.
2. You: `pnpm spike:voice`, tunnel HTTPS to your phone, Bluetooth, paste the on-screen log.
3. M2: car client → server (STT → Chief → sanitiser → TTS). Browser TTS is a stand-in.

## Decisions & why

- **Cloud API v1, poll not webhooks.** Docs: v1 public beta; webhooks “coming soon”. Auth Basic (`API_KEY:`) or Bearer. Stop = cancel latest run (ignore 409) + archive (not DELETE).
- **Conversation = list runs + GET `result`.** No `/conversation` on v1.
- **Confirmation is session code, not an LLM tool.** `yes`/`no` cannot be triggered by worker text. Timeout = cancel.
- **Chief LLM default: OpenAI `gpt-4.1`** when keyed; otherwise `ScriptedLlm` + `--mock`.
- **Voice M0 uses Web Speech + oscillator**, not a vendor stream. Barge-in = cancel `speechSynthesis` on interim STT.
- **Hook thoughts/tool chatter → silent.** `afterFileEdit` → earcon with a path-free headline. Never copy `text` / `edits` / `tool_output` into TTS.

## Discoveries / gotchas

### Cloud Agents API (docs only — live spike not run)

Create `POST /v1/agents` returns `{ agent, run }`. Agent `status`: `ACTIVE` | `IDLE` | `ARCHIVED`. Run: `CREATING` | `RUNNING` | `FINISHED` | `ERROR` | `CANCELLED` | `EXPIRED`. Follow-up `POST /v1/agents/{id}/runs` → `409 agent_busy` if a run is active. Terminal run: `durationMs`, `result`, `git.branches[]` with `repoUrl` **without** scheme.

**Live latency:** TBD. Blocked on keys.

### Logging hook (observed 2026-09-30, Cursor 3.22.12)

Common stdin fields: `conversation_id`, `generation_id`, `session_id`, `hook_event_name`, `cursor_version`, `workspace_roots`, `transcript_path`, **`user_email` (PII)**.

| Event | Extra fields | Notes |
|---|---|---|
| `afterFileEdit` | `file_path`, `edits[{old_string,new_string}]` | Full diffs. Do not speak. |
| `preToolUse` | `tool_name`, `tool_input` **object**, `tool_use_id` | Chatter → silent. |
| `postToolUse` | + `tool_output` (string), `duration` (ms, float) | Grep example **18.969ms**. |
| `afterAgentThought` | `text`, `duration_ms` | Example **5076ms**. Silent. Can contain injection-like text. |
| `beforeMCPExecution` | `tool_name`, `tool_input` **JSON string**, `mcp_server_name`, `command` | Shape differs from `preToolUse`. |
| `afterMCPExecution` | + `result_json`, `duration` | Browser lock example **4.635ms**. |
| `beforeSubmitPrompt` | `prompt`, `composer_mode`, `attachments[]` | Fires on user send. |
| `stop` | `status`, `loop_count`, `model`/`model_id`/`model_params` | Observed `status: "error"` with `loop_count: 0` on an aborted turn. |

Not observed this session: `sessionStart`, `sessionEnd`, `afterAgentResponse`, `subagentStart`/`subagentStop`. Session likely began before the project hook was saved.

Gotcha: `tool_use_id` can contain an embedded newline (`call-…\nfc_…`). Fail-open dump is correct; parsers must not assume a single-line id.

### Car client button: why it felt stuck (fixed 2026-09-30)

`mode` was the only record of "we are listening", and nothing kept it honest:

- Every early return in `startTalk` (no `SpeechRecognition`, mic denied, hands-free off) left `mode === "TALK"` with the label "Listening… tap to stop" over a dead mic.
- Chrome ends a recognition session on its own after a pause **even with `continuous = true`**. `onend` only nulled the object, so the mic silently closed and never reopened.
- The 8s idle timer was the single escape, and it gave up without re-arming whenever `speaking` was true, so TALK could become permanent.
- The mic stayed open while `speechSynthesis` played, so Herald's own voice came back through the speakers, produced an interim transcript, and ended the turn about a second after it opened. On speakers this is the "it stops listening immediately" symptom.
- A non-routine STT error (`network` in embedded Chromium, `service-not-allowed`) called `backToMedia` within milliseconds of the press, which also reads as an instant stop.
- `applyState` re-applied CONFIRM on **every** state push, dragging the UI back into a mode the driver had just left.
- After a read-back, `say()` overwrote CONFIRM with BRIEFING, so `afterSpeech`'s `mode === "CONFIRM"` check never matched and the mic never opened for "yes".

Now: `talkTurn` (intent) and `micOpen` (from `onstart`/`onend`) are separate; the label and the lamp pulse follow `micOpen`, never intent. `onend` reopens mid-turn up to 4 times, then gives up loudly. Any failure returns to media with a spoken-style caption. `afterSpeech` reopens the mic when the turn is still live or when `needsAnswer` is set (covers CONFIRM). The button is real push-to-talk: hold past 500ms and release to send, or tap to toggle; a press during a briefing is barge-in. `speechSynthesis` has an `onend` watchdog because Chrome drops that event on backgrounded tabs.

Follow-up fix: push-to-talk release previously called `abort()` unless an interim result had already arrived. Web Speech often emits its first/final result only after `stop()`, so short held recordings were discarded. Release now calls `stop()` and waits up to 1.8s for the final result. While the button remains held, neither a Web Speech final result nor the tap-mode silence timer may submit early.

**Deviation from AGENTS §4:** the mic is closed while Herald speaks, so voice barge-in only works through the button (or after the line ends). Echo cancellation can't be relied on when the phone plays into car speakers, and a self-transcribing mic breaks the turn. Revisit with a streaming STT vendor that does echo suppression.

### Phone voice / Bluetooth / PTT

Measured in **Cursor embedded Chromium** (not a phone, not Bluetooth):

| Metric | Value |
|---|---|
| `speechSynthesis` present | true |
| Web Speech STT constructor | true |
| Media Session API | true |
| Media Session play/pause/stop bound | true (after Play demo track) |
| Web Audio oscillator start → first sample | **0ms** |
| `speechSynthesis` `onstart` (“Ready.”) | **260ms** |
| Speak-test-line UI mode | LISTEN → **BRIEFING** |

Not measured: `getUserMedia` grant time, STT final transcript, barge-in cut, headset play/pause delivering `mediaSession` actions (the OS may keep those for the system music app). Safari on a phone needs **HTTPS**.

M2 STT→Chief→TTS budget: scripted Chief round-trip is negligible; browser TTS ~260ms; remaining budget for STT + real LLM is tight vs the ~1.5–2s target.

### M1 Chief (mock, this machine)

```
[CONFIRM] I'll start an agent to add a health-check endpoint on main, with tests, and open a pull request. Go ahead?
[TALK] The agent is running. I'll cut in if it needs you.
(launched mock-1)
```

Wall clock for that piped script including `tsx` startup was **~700ms**. No cloud launch, no OpenAI.

### GitHub MCP (observed 2026-09-30)

- Endpoint `https://api.githubcopilot.com/mcp/readonly`, Streamable HTTP, `Authorization: Bearer <fine-grained PAT>`. Works.
- Default toolset has **no `actions_*`** tools, so CI comes from `pull_request_read` `method: get_check_runs`. Reviews: `method: get_reviews`.
- `get_me` returns JSON as a text content block: `{login,id,profile_url,details{...}}`. Raw dumps in `.herald/raw/mcp/` contain profile data (gitignored).
- **Verified on real payloads** (public repo `github/github-mcp-server`, since the demo repo `cicmen35/car_wash_booking` has 0 PRs): `list_pull_requests` -> bare array with `number,state,draft,html_url,head.ref,user.login`; **`merged` is always `false` in list output, `merged_at` is present only when merged** (parser uses `merged_at`); `search_pull_requests` -> `{total_count,incomplete_results,search_type,items[]}` (`items` absent when 0); `pull_request_read get_check_runs` -> `{total_count,check_runs[{name,status,conclusion}]}`; `get_reviews` -> array of `{state,user}`.
- Latency (read-only, one call): list PRs 0.6-1.4s, search 0.3-0.4s, check runs 1.6s, reviews 1.9s. A full poll of a repo with up to 5 own PRs is roughly 2-3s (calls run in parallel); fine for a 45s poll, too slow for a per-utterance call, so the Chief answers from the poller's last snapshot.
- Still unverified: that Cursor cloud-agent PRs use a `cursor/` branch prefix; end-to-end with an open PR on the demo repo (none exist yet).

## Open questions for the human

1. **`CURSOR_API_KEY` + `HERALD_TEST_REPO`** (https GitHub URL the key can use).
2. Confirm **OpenAI** for the real Chief, or name another provider.
3. M2 STT/TTS: stay on browser APIs for the demo, or a streaming vendor (needs a key)?
4. Phone log: mic ms, STT ms, TTS ms, barge-in, whether headset play/pause toggled PTT.

## How to run / test / demo

```bash
pnpm install
pnpm test
pnpm spike:hook          # synthetic dump
pnpm chief:mock          # M1 acceptance
pnpm spike:voice         # http://127.0.0.1:8787
# phone: cloudflared tunnel --url http://127.0.0.1:8787
# Play demo track → Speak test line → talk to barge in → headset play/pause
pnpm spike:cloud         # needs keys in .env
```
