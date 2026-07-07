# Handoff Note — 071322 · gpt · complete-translation

## Inherited context

User explicitly requested a new handoff thread and clarified that handoff notes belong in the project-root `conversations/` directory, not the skill installation directory. Project-root thread used:

`conversations/260707-chat-responses-claude-translation/`

No prior notes existed in this thread before this note.

The worktree already had many unrelated modified/untracked files from earlier CloudGPT/provider work. Do not revert those. This session only intended to touch chat/provider translation surfaces and related tests/docs.

## Work done this session

- [x] Researched public JS/TS translation projects via GitHub.
- [x] Noted strongest usable references:
  - `lidge-jun/opencodex` — MIT, strong Responses/Codex ↔ Anthropic streaming bridge ideas.
  - `nocoo/raven` — MIT, same Bun/Hono ecosystem and strategy-pattern API translation.
  - `nsxdavid/anthropic-max-router` — MIT, self-contained OpenAI Chat ↔ Anthropic translator, but educational disclaimer and incomplete streaming tool-call coverage.
  - `insightflo/chatgpt-codex-proxy` and `tingxifa/claude_proxy` are useful references but have no license, so code was not copied.
- [x] Added local translation module for OpenAI Chat Completions ↔ Anthropic Messages and OpenAI Chat Completions ↔ Responses.
- [x] Wired `/:provider`/top-level `model: "provider/model"` chat completions routing so provider aliases can target:
  - `openai-compatible` providers by existing pass-through behavior,
  - `openai-responses` providers, including `codex`, through Chat → Responses translation,
  - `anthropic` providers through Chat → Messages translation.
- [x] Added focused tests covering Chat → Responses, Responses stream → Chat chunks, and Chat → Anthropic provider Messages.
- [x] Updated README feature bullets in English and Chinese.
- [x] Verified with typecheck, targeted tests, and lint.

## Current state

Files changed by this session:

| File | Change |
| ---- | ------ |
| `src/routes/chat-completions/translation.ts` | New local adapter module. Converts OpenAI Chat payloads to Anthropic Messages and Responses payloads; converts Anthropic/Responses results and streams back to Chat Completions objects/chunks. |
| `src/routes/provider/chat-completions/handler.ts` | Provider chat completions routing now supports `openai-compatible`, `openai-responses`, and `anthropic` effective provider types. Codex goes through `forwardCodexResponses`. |
| `tests/provider-chat-completions-alias.test.ts` | Updated old openai-responses rejection test into positive Chat → Responses coverage; added streaming Responses and Anthropic provider tests. |
| `README.md` | Feature bullet now documents provider translation on chat and Messages APIs. |
| `README.zh-CN.md` | Same documentation update in Chinese. |

Verification commands run:

```sh
bun run typecheck
bun test tests/provider-chat-completions-alias.test.ts tests/provider-openai-compatible.test.ts tests/messages-handler.test.ts tests/messages-api-flows.test.ts tests/responses-translation.test.ts tests/codex-create-responses.test.ts
bun run lint
```

Final results:

- TypeScript: passed.
- Targeted tests: 94 pass, 0 fail.
- ESLint/Prettier: passed.

## Open tasks for the next agent

1. Optional: use local `~/raven` source for a deeper comparison of edge-case streaming behavior, especially if future bugs appear around tool-call deltas or usage chunks.
2. Optional: add direct end-to-end tests for built-in `codex/gpt-5.4` on `/v1/chat/completions` with mocked Codex auth state. Current tests cover generic `openai-responses`; Codex uses the same handler branch plus `forwardCodexResponses`.
3. Optional: improve Chat → Anthropic image URL handling for non-data remote image URLs. Current adapter maps data URLs to Anthropic base64 image blocks and falls back to text for non-data URLs.

## Key decisions

| Decision | Rationale |
| -------- | --------- |
| Did not copy no-license code from `insightflo/chatgpt-codex-proxy` or `tingxifa/claude_proxy` | No LICENSE/private package means copying code would be legally risky. |
| Implemented local adapters instead of importing/copying Raven wholesale | Existing project already had strong Anthropic↔Responses primitives; a focused local adapter was smaller and fit existing types/routes. |
| Reused existing Responses → Anthropic stream translator when producing Chat chunks | Avoids duplicating complex Responses event parsing and preserves existing behavior for reasoning/tool calls. |
| Changed `/v1/chat/completions` provider aliases from rejecting `openai-responses` to translating them | User explicitly wanted chat→responses support for Codex/OpenAI Responses-style providers. |

## Blockers

- None.

## Suggested next step

If validating manually, configure Codex auth, start the server, and call `/v1/chat/completions` with `model: "codex/gpt-5.4"`; it should translate Chat Completions input into Codex Responses and return OpenAI Chat Completions output.
