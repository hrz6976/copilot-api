# Handoff Note — 091557 · gpt · fixed-gpt-tokens

## Inherited context

- No prior notes existed in `conversations/260709-opencode-codex-tokens/`.
- User reported OpenCode/Codex failing with upstream error: `Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.`
- Initial broad approach was interrupted by user, who clarified the fix should apply only to the GPT model series and asked to check for similar existing logic.

## Work done this session

- [x] Found existing inline behavior in `src/routes/chat-completions/handler.ts`: GPT models moved `max_tokens` to `max_completion_tokens`.
- [x] Extracted that behavior into shared `applyGptModelTokenLimitParam` in `src/lib/provider-payload.ts`.
- [x] Reused the helper in top-level Chat Completions and provider OpenAI-compatible Chat Completions, Messages translation, and Responses fallback paths.
- [x] Kept the logic GPT-only via `^gpt-`.
- [x] Added regression tests for GPT-series provider Chat Completions, OpenCode-style Messages translation, and Responses fallback.
- [x] Ran focused tests, typecheck, and lint successfully.

## Current state

Working tree has uncommitted source/test changes for this fix. Existing unrelated untracked files remain untouched.

| File | Change |
| --- | --- |
| `src/lib/provider-payload.ts` | Added GPT-only token-limit normalizer and GPT-series predicate. |
| `src/routes/chat-completions/handler.ts` | Replaced inline GPT `max_tokens` rewrite with shared helper. |
| `src/routes/provider/chat-completions/handler.ts` | Applies shared helper before forwarding OpenAI-compatible provider chat payloads. |
| `src/routes/provider/messages/handler.ts` | Applies shared helper to Anthropic Messages -> OpenAI Chat payloads. |
| `src/routes/provider/responses/handler.ts` | Applies shared helper to Responses -> Chat fallback payloads. |
| `tests/provider-chat-completions-alias.test.ts` | Covers direct provider Chat Completions GPT-series rewrite. |
| `tests/provider-openai-compatible.test.ts` | Covers OpenCode-style provider Messages GPT-series rewrite. |
| `tests/provider-responses-openai-compatible.test.ts` | Covers Responses fallback GPT-series rewrite. |

## Open tasks for the next agent

1. Commit the fix if the user wants it committed/pushed.
2. If preparing another npm release, bump to the next publishable version after `1.13.20-post.1`.

## Key decisions

| Decision | Rationale |
| --- | --- |
| Limit rewrite to `^gpt-` models | User clarified this should apply only to GPT model series. Existing repo GPT-version helpers also use anchored `gpt-` matching. |
| Extract from top-level inline behavior | The codebase already had this behavior in the main Chat Completions path; provider routes needed to reuse it. |
| Do not include `codex-*` or `o*` | User explicitly narrowed scope after the broader provisional helper. |

## Blockers

- None.

## Suggested next step

Review the diff, then commit and push if this should go into the next post release.
