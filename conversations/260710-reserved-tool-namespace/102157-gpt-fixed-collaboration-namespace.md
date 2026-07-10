# Handoff Note — 102157 · gpt · fixed-collaboration-namespace

## Inherited context

- No matching prior handoff thread existed, so this thread was created for the CloudGPT GPT-5.6 reserved tool namespace failure.
- The latest local Codex source at `~/codex` declares namespace-tool support as a provider capability and uses `collaboration` as the multi-agent v2 namespace.
- Upstream `caozhiyuan/copilot-api` at `701c92a` had no adaptation for the new GPT-5.6 reserved `collaboration` namespace error.

## Work done this session

- [x] Traced native Responses routing for `cloudgpt/gpt-5.6-sol-20260709`.
- [x] Confirmed GPT-5.6 rejects ordinary JSON namespace tools named `collaboration` because that name is reserved for encrypted model-internal tool use.
- [x] Added reversible request aliasing from `collaboration` to `codex_collaboration` for CloudGPT GPT-5.6 models only.
- [x] Restored the original namespace in non-streaming JSON and streaming SSE function calls returned to Codex CLI.
- [x] Added unit, JSON route, and SSE route tests.
- [x] Ran lint, typecheck, targeted tests, full tests, and build.

## Current state

| File | Change |
| --- | --- |
| `src/lib/reserved-tool-namespace.ts` | New immutable recursive alias/restore helper and CloudGPT GPT-5.6 guard. |
| `src/routes/provider/responses/handler.ts` | Applies alias before native provider `/v1/responses` forwarding and restores JSON/SSE responses. |
| `tests/reserved-tool-namespace.test.ts` | Covers model scoping, request replay aliasing, immutability, and response restoration. |
| `tests/provider-responses-openai-compatible.test.ts` | Covers native CloudGPT GPT-5.6 JSON and SSE gateway behavior. |

Validation:

- `bun run lint ...` passed.
- `bun run typecheck` passed.
- Targeted tests: 25 passed, 0 failed.
- Full suite: 462 passed; 3 unrelated existing failures in `tests/provider-resolver.test.ts` because subprocess debug logs precede JSON output.
- `bun run build` passed, with the repository's existing tsdown `define` option warning.

## Open tasks for the next agent

1. Optionally test against the live CloudGPT endpoint with Codex CLI multi-agent v2 enabled.
2. Consider replacing the hard-coded GPT-5.6 guard with provider/model capability metadata if other models or providers adopt the same reservation.
3. Do not include unrelated untracked files `cloudgpt_aoai.py` or `conversations/260709-cloudgpt-model-catalog/101614-gpt-complete-gpt56-pricing.md` in any commit unless explicitly intended.

## Key decisions

| Decision | Rationale |
| --- | --- |
| Alias instead of stripping collaboration tools | Preserves Codex CLI sub-agent functionality rather than silently disabling it. |
| Restore all JSON/SSE response namespaces | Codex dispatches tool calls using its locally registered `collaboration` namespace. |
| Scope to CloudGPT GPT-5.6 | Avoids altering native namespace semantics for Codex, Copilot, and older/other provider models. |
| Use `codex_collaboration` as alias | Valid ordinary namespace, readable for diagnostics, and distinct from the reserved exact name. |

## Blockers

- None for the code fix. Live CloudGPT verification requires valid credentials and endpoint access.

## Suggested next step

Run a real Codex CLI turn using `cloudgpt/gpt-5.6-sol-20260709` that invokes `spawn_agent` and confirm the gateway logs show `codex_collaboration` upstream while the client receives `collaboration`.
