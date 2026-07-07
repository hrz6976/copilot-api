# Handoff Note — 071328 · gpt · reviewed-raven

## Inherited context

Read prior project-root handoff note:

- `conversations/260707-chat-responses-claude-translation/071322-gpt-complete-translation.md`

Locked-in context from that note:

- The project-root thread is `conversations/260707-chat-responses-claude-translation/`.
- `/v1/chat/completions` provider aliases were already wired for:
  - `openai-compatible` passthrough,
  - `openai-responses` / `codex` via Chat → Responses → Chat translation,
  - `anthropic` via Chat → Anthropic Messages → Chat translation.
- Verification before this review had passed: `bun run typecheck`, targeted translation tests, and `bun run lint`.
- The worktree already had unrelated CloudGPT/provider changes before translation work; do not revert unrelated files.

## Work done this session

- [x] Inspected local Raven source under `~/raven`.
- [x] Compared Raven's translator/strategy design against the current `copilot-api` adapters.
- [x] Reviewed the prior design decisions and confirmed the local-adapter approach remains the right fit.
- [x] Applied one Raven-informed hardening: translated provider chat streams now surface upstream Anthropic/Responses stream errors as OpenAI-style SSE `event: error` payloads instead of converting the error message into assistant text.
- [x] Added regression tests for Responses stream failures and Anthropic provider stream errors.
- [x] Re-ran verification after the hardening.

Raven files inspected:

- `~/raven/LICENSE` — MIT license confirmed.
- `~/raven/package.json` — Bun monorepo, `@raven/proxy` package.
- `~/raven/packages/proxy/src/protocols/translate/non-stream-translation.ts`
- `~/raven/packages/proxy/src/protocols/translate/stream-translation.ts`
- `~/raven/packages/proxy/src/strategies/copilot-responses.ts`
- `~/raven/packages/proxy/src/strategies/custom-openai.ts`
- `~/raven/packages/proxy/src/strategies/custom-anthropic.ts`
- Representative Raven tests:
  - `~/raven/packages/proxy/test/translate/openai-to-anthropic.test.ts`
  - `~/raven/packages/proxy/test/translate/anthropic-to-openai.test.ts`
  - `~/raven/packages/proxy/test/strategies/copilot-responses-tool-filter.test.ts`
  - characterisation stream tests under `~/raven/packages/proxy/test/characterisation/`
- Raven docs:
  - `~/raven/docs/16-openai-responses-api.md`
  - `~/raven/docs/18-native-anthropic-messages.md`

## Current state

This review session made a small additional code change beyond the original translation implementation:

| File | Change |
| ---- | ------ |
| `src/routes/chat-completions/translation.ts` | Added `ChatStreamTranslationError` / `ChatStreamTranslationResult` and result-returning stream translation helpers so Anthropic/Responses stream error events can be surfaced explicitly. The older chunk helper no longer turns Anthropic errors into assistant content. |
| `src/routes/provider/chat-completions/handler.ts` | Uses the new result helpers and writes OpenAI-style `event: error` SSE payloads for translated Anthropic/Responses chat streams. Raw Responses `type: "error"` events now share the same error body helper. |
| `tests/provider-chat-completions-alias.test.ts` | Added regression coverage that Responses `response.failed` and Anthropic `type: "error"` streams emit `event: error` and do not emit the error message as assistant `content`. |

Verification after this review:

```sh
bun test tests/provider-chat-completions-alias.test.ts
bun run typecheck
bun test tests/provider-chat-completions-alias.test.ts tests/provider-openai-compatible.test.ts tests/messages-handler.test.ts tests/messages-api-flows.test.ts tests/responses-translation.test.ts tests/codex-create-responses.test.ts
bun run lint
```

Results:

- Focused provider chat tests: 17 passed, 0 failed.
- TypeScript: passed.
- Targeted translation suite: 96 passed, 0 failed.
- Lint: passed.

## Raven comparison summary

Raven mostly solves the inverse and adjacent problems:

- Raven's `non-stream-translation.ts` translates Anthropic Messages ↔ OpenAI Chat Completions.
- Raven's `stream-translation.ts` translates OpenAI Chat stream chunks → Anthropic stream events.
- Raven's `custom-openai` strategy uses translation only when serving Anthropic `/v1/messages` through OpenAI-compatible upstreams; otherwise it preserves upstream bytes.
- Raven's `custom-anthropic` strategy is pure passthrough.
- Raven's `copilot-responses` strategy treats `/v1/responses` mostly as passthrough, with Copilot/Codex compatibility preprocessing for unsupported tool types and namespace tool flatten/restore.

Important implication: Raven does not provide a drop-in Chat Completions → Responses adapter for this project. The local adapter remains necessary for the user's `Codex` use case on `/v1/chat/completions`.

## Key decisions

| Decision | Rationale |
| -------- | --------- |
| Keep the local adapter module instead of importing/copying Raven wholesale | Raven is MIT, but its translator direction and type system are different. `copilot-api` already has strong local Responses ↔ Anthropic primitives, and the missing feature was specifically Chat → Responses / Chat → Anthropic provider routing. |
| Keep translation at provider-routing boundaries | Matches Raven's documented principle: preserve native format when possible and translate only when the selected upstream protocol requires it. |
| Continue reusing `src/routes/messages/responses-stream-translation.ts` for Responses → Anthropic before mapping to Chat chunks | Raven reinforces avoiding duplicated streaming state machines. Reuse preserves existing reasoning, compaction, tool-search, and function-call parsing behavior. |
| Do not add Raven's namespace-tool flatten/restore to Chat → Responses right now | OpenAI Chat Completions tools can only represent function tools, so the Chat → Responses adapter does not naturally emit Responses `namespace` tools. Raven's namespace logic is relevant for direct `/v1/responses` or Anthropic deferred-tool flows, not the current Chat Completions alias path. |
| Preserve the non-data-url image fallback for Chat → Anthropic | Anthropic Messages does not accept arbitrary remote `image_url` in the same way OpenAI Chat does. Fetching remote URLs inside the proxy would add privacy, latency, and failure-mode concerns; a future explicit opt-in could encode remote images if needed. |
| Surface stream errors as SSE errors | Raven's strategies surface translated stream errors as error events. Converting an upstream error to assistant text hides failure semantics from OpenAI clients, so this review hardened the implementation. |

## Open tasks for the next agent

1. Add a direct mocked `codex/gpt-5.4` `/v1/chat/completions` test if confidence in the built-in Codex branch needs to be higher. Current coverage exercises generic `openai-responses`; Codex shares the same branch but calls `forwardCodexResponses`.
2. If users pass Responses-native `namespace` tools through provider `extraBody`, consider a scoped compatibility layer inspired by Raven's `copilot-responses.ts`. Do not add it blindly to Chat → Responses because standard Chat tools cannot express namespaces.
3. If users require remote images for Anthropic providers, design an explicit opt-in fetch-and-base64 pipeline with size limits, MIME validation, timeout handling, and privacy documentation.
4. Consider unit tests for `src/routes/chat-completions/translation.ts` directly, beyond route-level tests, for complex mixed text/tool/image/file payloads.

## Blockers

- None.

## Suggested next step

If continuing, add a direct Codex-provider route test for `model: "codex/gpt-5.4"` with mocked Codex auth and verify both non-streaming and streaming Chat → Responses → Chat behavior.
