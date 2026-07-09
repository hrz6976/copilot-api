# Handoff Note — 091205 · claude · refactored-translation

## Inherited context

Read all notes in `conversations/260707-cloudgpt-provider/` and `conversations/260707-chat-responses-claude-translation/`. That work (committed as 739271e "feat: add CloudGPT provider translations") added CloudGPT Azure CLI auth, a static 76-model catalog, pricing, and a 2,251-line `src/routes/chat-completions/translation.ts` implementing Chat↔Anthropic, Chat↔Responses, and Responses→Chat protocol translation, plus ~800 lines across the provider handlers. It was heavily E2E-validated but never structurally reviewed.

This session: user asked to review and refactor those changes. Four parallel review agents audited the commit (stream state machines, non-stream translation, provider handlers, CloudGPT auth/catalog), producing 22 findings; the confirmed ones were fixed and the monolith was split.

## Work done this session

- [x] Multi-agent correctness review of commit 739271e (22 findings, most verified by executing the code).
- [x] Split `translation.ts` (2,251 lines, deleted) into a dedicated `src/routes/translation/` module (per user direction — the translators are shared by the provider handlers, not owned by the chat-completions route):
  - `chat-to-anthropic.ts` — Chat→Anthropic payload; Anthropic response/stream→Chat.
  - `chat-to-responses.ts` — Chat→Responses payload; Responses result/stream→Chat (layers on the Anthropic bridge).
  - `responses-to-chat.ts` — Responses→Chat payload; Chat response/stream→Responses events (Codex-on-chat-only fallback).
  - `utils.ts` — shared helpers (`parseDataUrl`, `getTextFromOpenAIContent`, `isRecord`, …).
- [x] Fixed translation bugs:
  - CRITICAL: Responses input messages without `type: "message"` (the standard OpenAI SDK shape) were silently dropped → empty upstream `messages`.
  - Reasoning input items now merge **forward** into the next assistant message/tool call (was backward, creating invalid `content: null` assistant messages).
  - Namespace tool flattening (`ns__name`) now applied consistently to `tool_choice` and replayed `function_call` items, and **restored** (`name` + `namespace`) on output items and stream events via name maps built from the request tools.
  - Rewrote `repairOpenAIChatToolMessageOrder` as a claim-based rebuild (old version emitted invalid orderings for interleaved multi-turn tool calls).
  - Chat→Responses now replays assistant `reasoning_opaque`/text as a `reasoning` input item (reasoning continuity), only sends `parallel_tool_calls` when tools exist, and passes `minimal`/`none` reasoning efforts through.
  - Streaming: `message_delta` without `stop_reason` no longer emits a premature `finish_reason: "stop"`; `usage.input_tokens` from `message_delta` now reaches chunk usage (Responses→Chat streams undercounted prompt tokens); tool-call-only Chat→Responses streams no longer emit a phantom empty message item; reasoning deltas now produce a proper reasoning output item with summary events.
- [x] Fixed handler bugs:
  - Mid-stream `data: {"error":...}` lines from OpenAI-compatible upstreams now surface as SSE `event: error` instead of being dropped and finalized as a fabricated `response.completed`; empty streams also error instead of fabricating completion.
  - New `resolveEffectiveProviderConfig` in `src/lib/config.ts` (with `configuredAuthType` retained on `ResolvedProviderConfig`) applied in **all** branches of chat/responses/messages handlers — fixes wrong auth header + `anthropic-*` header leakage on per-model type overrides, and honors an explicitly configured authType.
  - Responses fallback now applies model defaults, DashScope thinking default, and context cache (was skipped); openai-responses chat streaming checks content-type; `.clone()` leaks removed on translated (non-proxied) responses; unknown provider on `/v1/responses` now 404s like the chat route.
- [x] Fixed CloudGPT issues:
  - `az` spawn now works in packaged desktop builds: `shell: true` on Windows (az is `az.cmd`), PATH augmented with Homebrew locations on macOS.
  - Static model catalog served without acquiring an Azure CLI token (`getProviderConfig` check before `resolveProviderConfig` in both models routes).
  - 30s min-refresh-interval guard stops per-request `az` spawns when az returns a near-expiry cached token.
- [x] Deduplicated: `applyMissingExtraBody`/`applyProviderStreamOptions`/`applyProviderContextCache` (3 copies) → new `src/lib/provider-payload.ts`; effective-config logic (2 divergent copies) → `config.ts`.
- [x] Added regression tests: new `tests/protocol-translation.test.ts` (13 unit tests), plus route tests for mid-stream errors, empty streams, az-free catalog, and `resolveEffectiveProviderConfig`.
- [x] Validation: `bun test` 427 pass / 0 fail; typecheck, lint, `bun run build`, `bun run build:desktop`, `git diff --check` all pass.
- [x] Live verification against real CloudGPT (server on port 4161, temp `COPILOT_API_HOME`): `/v1/models` 97 models in 16ms (no az spawn); Responses→Chat fallback non-stream + stream with bare `{role, content}` input; Chat→Responses non-stream + stream (`gpt-4.1-nano` override); `/v1/messages`; namespace tool round trip (`tool_choice` flatten + output restore + replay turn returned `SECRET=RAVEN-7429`); bad-model 400; unknown-provider 404.
- [x] Real-agent E2E (server on port 4162, same multi-step job: read two files, join contents, write `result.txt`, print marker):
  - Codex CLI 0.142.x, `wire_api = "responses"`, `model = cloudgpt/DeepSeek-V3.2` → full tool loop through the Responses→Chat fallback, `CODEX_E2E_OK:RAVEN-7429`, 72.8k tokens.
  - Claude Code, `ANTHROPIC_BASE_URL` → gateway, `cloudgpt/DeepSeek-V3.2` → 8 turns over `/v1/messages` (Anthropic→Chat translation), `CLAUDE_E2E_OK:RAVEN-7429`.
  - opencode via `@ai-sdk/anthropic` (`baseURL .../v1`) → streamed `/v1/messages` tool loop, `OPENCODE_E2E_OK:RAVEN-7429`.
  - Chat→Anthropic direction closed with a `loopback` provider (`type: "anthropic"`, baseUrl = the gateway itself → Copilot `/v1/messages`): non-stream marker reply plus a streamed tool call (`finish_reason: "tool_calls"`, single finish chunk, correct args accumulation, `prompt_tokens` populated).

## Current state

All changes are **uncommitted** in the worktree on branch `dev`. `bun test`: 427 pass. Two deliberate test-behavior updates: interleaved system note now stays in chronological position after tool results (`tests/provider-responses-openai-compatible.test.ts`), and near-expiry token refresh respects the min interval (`tests/cloudgpt-token.test.ts`).

| File | Change |
| ---- | ------ |
| `src/routes/chat-completions/translation.ts` | Deleted (split into four modules). |
| `src/routes/translation/{chat-to-anthropic,chat-to-responses,responses-to-chat,utils}.ts` | New module directory; all translation bug fixes live here. |
| `src/lib/config.ts` | `configuredAuthType` on `ResolvedProviderConfig`; new `resolveEffectiveProviderConfig`. |
| `src/lib/provider-resolver.ts` | CloudGPT resolution pins `configuredAuthType: "authorization"`. |
| `src/lib/provider-payload.ts` | New shared payload-prep helpers. |
| `src/lib/cloudgpt-token.ts` | Windows/macOS spawn portability; min-refresh-interval guard. |
| `src/routes/provider/{chat-completions,responses,messages}/handler.ts` | Effective-config everywhere, stream-error surfacing, payload prep in fallback, clone/content-type/404 fixes, local helper copies removed. |
| `src/routes/models/route.ts`, `src/routes/provider/models/route.ts` | CloudGPT static catalog served before token resolution. |
| `tests/*` | New `protocol-translation.test.ts`; extended provider-auth, models-route, provider-responses-openai-compatible, cloudgpt-token tests. |

## Open tasks for the next agent

1. If the user wants this persisted: commit (suggest `refactor: split provider translation modules and fix review findings`), with the `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer convention used by 739271e. `cloudgpt_aoai.py` remains untracked; user preference needed.
2. Remaining review findings deliberately NOT addressed (lower priority / larger design):
   - No client-abort propagation in the three streaming pumps (no `stream.onAbort`, no `AbortSignal` on `forwardProvider*` fetches) — disconnected clients leave upstream requests running. Pre-existing pattern.
   - No SSE `error` event when the upstream iterator throws mid-stream (only `finally { recordUsage }`).
   - The SSE pump scaffolding across the handlers could still collapse into one generic `pumpTranslatedSSE` helper (see review duplication map).
   - `applyProviderModelDefaults` uses `??=`, creating own `undefined` properties that block `applyMissingExtraBody` from filling `temperature`/`top_p`/`top_k` from extraBody. Pre-existing.
   - `buildCustomProviderConfig` (`src/auth.ts`) and `buildProviderConfig` (`desktop/electron/provider-auth.ts`) are byte-identical copies.
   - Builtin-provider name checks (`codex`/`cloudgpt` chains) in resolver + two models routes could become a small registry.
   - `grok-4.3` in `pricing.ts` has a redundant top-level `cachedInput` alongside tiered values.
3. If Codex CLI compatibility matters for reasoning models behind the fallback: consider emitting stronger reasoning stream events parity (currently summary part/text events + final item).

## Key decisions

| Decision | Rationale |
| -------- | --------- |
| Split by translation direction, not by stream/non-stream | Each provider-handler branch imports exactly one directional module; stream state machines stay next to the payload translation they invert. |
| Housed under `src/routes/translation/` (user direction) | The translators serve the provider chat/responses/messages handlers, not the chat-completions route; a dedicated module makes that ownership explicit. The older Anthropic↔Chat/Responses translators under `src/routes/messages/` were left in place (widely imported by the messages routes) — unifying them here is a possible follow-up. |
| `configuredAuthType` stores only values that survived validation | Prevents per-request re-warning on invalid configured values while letting type overrides honor explicit user choices. |
| Order repair keeps displaced messages in chronological position (after tool results) | Old behavior moved interleaved notes before the assistant tool call, which broke interleaved multi-turn histories; both orderings satisfy adjacency but chronology is truthful. |
| Namespace restore built per-request from `sourcePayload.tools` | No cross-request state needed; both restore sites (non-stream result, stream state) already receive the source payload. |
| Reasoning input item emitted only when `reasoning_opaque` present | `encrypted_content` is required on the type and is what reasoning continuity actually needs; summary-only items without it risk upstream rejection. |
| min-refresh-interval (30s) instead of tracking az token identity | Simple, testable via injected `nowMs`, bounds spawn rate without risking expired-token reuse (still checks `expiresAtMs > nowMs`). |
| Kept the strict-ish chunk guard (id/model/choices) but surfaced error lines and unrecognized chunks | Loosening fully would let malformed objects into the translator; the real bug was silence, not strictness. |

## Blockers

- None. All validation green; live CloudGPT verification passed.

## Suggested next step

Review the diff (`git diff` + new files) and commit if satisfied; then consider the abort-propagation and SSE-pump-unification follow-ups from Open tasks item 2.
