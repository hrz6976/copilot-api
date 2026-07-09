# Handoff Note — 092159 · claude · fixed-stream-error-passthrough

## Inherited context

No prior handoff thread matched this task. Started fresh. Trigger: user on Codex CLI
with `gpt-5.5` got `stream disconnected before completion: stream closed before
response.completed`, while the backend logged the real cause `encrypted content could
not be verified`. Root ask: **pass upstream/mid-stream errors through to the client
instead of silently closing the SSE socket.** User then broadened scope: "Error
passthrough should be a universal problem. You need to fix all of them."

Decision locked in (user-selected): surface errors as a synthetic **`response.failed`
event followed by an `error` event** for the Responses protocol; Anthropic routes use
`buildErrorEvent` (`event: error`), OpenAI-chat routes use an `{error:{...}}` chunk +
`[DONE]`.

## Root cause

Every `streamSSE(c, async (stream) => {...})` callback uses the 2-arg form (no Hono
`onError`). When the callback throws (upstream connection reset, aborted body,
`JSON.parse` throw), Hono closes the socket writing **no** error event. The route-level
`try/catch → forwardError` does NOT help — `streamSSE` returns the Response immediately
and the callback runs afterward. Only an in-callback `try/catch` can surface the error.
Two separate cases: (a) a **thrown** exception mid-iteration, and (b) an upstream
**`error`-typed SSE chunk** that was forwarded raw (or, for websocket safe-streams, as a
bare `error` without a `response.failed`).

## Work done this session

- [x] Investigated all streaming routes (2 Explore agents) — confirmed the gap is
      universal across every upstream-consuming SSE stream.
- [x] Created shared Responses helper `src/routes/responses/stream-error.ts`:
      `writeResponsesStreamFailure` (emits `response.failed` + `error`, returns last
      seq #), `getResponsesStreamErrorInfo`, `parseResponsesStreamErrorInfo`,
      `buildFailedResponsesResult`.
- [x] Added generic `getStreamErrorMessage(error, fallback?)` to `src/lib/error.ts`.
- [x] Wired error passthrough into all Responses paths: native `handleResponses`,
      `streamProviderResponses` (codex + openai-responses), and
      `streamOpenAICompatibleProviderResponses`. Detects both thrown errors and upstream
      `error`-typed chunks.
- [x] Wired OpenAI-chat paths: native `chat-completions/handler.ts` + all 3 provider
      chat blocks via new `writeOpenAIChatStreamFailure`.
- [x] Wired Anthropic paths: `messages/api-flows.ts` (3 blocks) via new
      `writeAnthropicStreamError`; `provider/messages/handler.ts` (3 blocks) via new
      `writeProviderMessagesStreamError`.
- [x] Removed now-unused `createResponsesStreamErrorEvent` from provider responses handler.
- [x] Added tests (see table). Full suite: **459 pass / 0 fail**. typecheck ✅ lint ✅.

## Current state

| File | Change |
| ---- | ------ |
| src/routes/responses/stream-error.ts | **NEW** shared `response.failed`+`error` emitter + error-info extractors |
| src/lib/error.ts | + `getStreamErrorMessage()` |
| src/routes/responses/handler.ts | try/catch + upstream `error`-chunk → failure; `getResponsesStreamEventErrorInfo` helper |
| src/routes/provider/responses/handler.ts | try/catch in both stream fns; `error`-event detection in `writeChunk`; openai-compatible 3 error branches now emit failure; removed old helper |
| src/routes/chat-completions/handler.ts | try/catch → `error` chunk + `[DONE]` |
| src/routes/provider/chat-completions/handler.ts | catch in 3 stream fns via `writeOpenAIChatStreamFailure` |
| src/routes/messages/api-flows.ts | try/catch in 3 stream blocks via `writeAnthropicStreamError` |
| src/routes/provider/messages/handler.ts | try/catch in 3 stream blocks via `writeProviderMessagesStreamError` |
| tests/responses-handler.test.ts | +2 (thrown; upstream error-event) |
| tests/messages-api-flows.test.ts | +3 (chat/responses/messages thrown) |
| tests/provider-responses-openai-compatible.test.ts | +1 thrown; asserts new `response.failed` on existing mid-stream test |
| tests/provider-responses-context-management.test.ts | +2 (thrown pull-stream; upstream error-event) |
| tests/provider-chat-completions-alias.test.ts | +1 thrown |
| tests/provider-openai-compatible.test.ts | +1 thrown (messages) |
| tests/provider-messages-web-search.test.ts | +1 thrown (responses→messages) |
| tests/chat-completions-handler.test.ts | **NEW** (thrown + success streaming) |

Commands run: `bun run typecheck` ✅, `bun run lint` ✅, `bun test` → 459 pass.
Nothing committed yet (branch `dev`, still dirty).

## Open tasks for the next agent

1. **(Optional coverage)** Only 1 of 6 new catch blocks is not directly unit-tested:
   `streamProviderMessages` (native Anthropic passthrough) in
   `src/routes/provider/messages/handler.ts:617`. It is a 2-line wrapper identical to
   the tested `streamResponsesProviderMessages`/`streamOpenAICompatibleProviderMessages`
   catches. To cover it, add a test using a provider whose effective type is native
   Anthropic (not `openai-responses`/`openai-compatible`) returning an erroring
   `text/event-stream` body, asserting `event: error`.
2. **(Verify against real Codex)** Confirm the original repro (`gpt-5.5` "encrypted
   content could not be verified") now shows the message in the Codex CLI rather than
   "stream closed before response.completed". Note: if the upstream returns HTTP 400
   *before* streaming, it already becomes a clean JSON error via `forwardError` — the
   fix targets the 200-then-fail streaming case.
3. **(Commit)** No commit made yet — user hasn't asked. Suggested message:
   `fix: surface mid-stream upstream errors to clients across all streaming routes`.

## Key decisions

| Decision | Rationale |
| -------- | --------- |
| Emit `response.failed` + `error` (not just `error`) | User choice; `response.failed` carries `response.error.message`, the field Codex renders |
| Handle thrown errors at the handler (streamSSE callback) level, not by safe-wrapping HTTP service streams | A safe-wrap converts throw→`error` chunk which the loop would forward as a bare `error` with no `response.failed`; handler catch emits both. Keeps HTTP service streams raw. |
| Tests simulate mid-stream throw with a **pull-based** `ReadableStream` that errors on the 2nd pull | `streamProviderResponses` peeks the first chunk *before* `streamSSE`; a `start()`-based enqueue+error surfaces on the first read → becomes a pre-stream 500, missing the in-callback catch. Pull-based defers the error into the streaming loop. |
| `throwingStream` test helper is a manual async-iterable (not `async function*`) | eslint `require-yield` rejects a generator with no `yield`. |

## Blockers

- (none)

## Suggested next step

Run the real Codex `gpt-5.5` repro against the running gateway to confirm the error
message now reaches the client; then commit on branch `dev`.
