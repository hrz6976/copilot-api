# Handoff Note — 071236 · gpt · complete-catalog

## Inherited context

Read all prior notes in `conversations/260707-cloudgpt-provider/`:

- `071115-gpt-continue-cloudgpt.md`: CloudGPT was first registered as a quick provider.
- `071116-gpt-researched-aad.md`: Microsoft Entra/AAD token generation and lifetime were researched.
- `071118-gpt-verified-token.md`: Local Azure CLI token acquisition and `/openai/ping` were validated without printing secrets.
- `071211-gpt-continue-refresh.md`: Design decision to use dynamic Azure CLI auth was recorded.
- `071217-gpt-complete-cloudgpt.md`: Azure CLI dynamic auth implementation was completed and validated.
- `071218-gpt-verify-smoke.md`: Live CloudGPT `/ping` and `/v1/chat/completions` smoke tests passed.

Locked-in decisions inherited:

- CloudGPT raw config uses `authType: "azure-cli"` and no stored `apiKey`.
- Runtime provider resolution converts CloudGPT Azure CLI auth to bearer `authorization`.
- Token values must remain redacted.
- Handoff notes belong under project-root `conversations/`.

## Work done this session

- [x] Read `cloudgpt_aoai.py` and extracted the active `cloudgpt_available_models` Literal list.
- [x] Added a built-in static CloudGPT model catalog with all 76 active model IDs and endpoint capability metadata.
- [x] Routed CloudGPT provider-scoped `/cloudgpt/v1/models` to the static catalog instead of upstream `/v1/models`.
- [x] Routed aggregated `/v1/models` to include static `cloudgpt/<model>` entries without calling upstream CloudGPT model listing.
- [x] Added built-in CloudGPT token pricing/cached-input pricing defaults in `src/lib/token-usage/pricing.ts`.
- [x] Updated README and README.zh-CN to mention static CloudGPT model discovery/pricing defaults.
- [x] Added tests for catalog coverage, model routes, and pricing.
- [x] Validated catalog IDs exactly match `cloudgpt_aoai.py`.
- [x] Ran targeted tests, full tests, typecheck, lint, builds, and whitespace check.

## Current state

The worktree still contains prior uncommitted CloudGPT dynamic auth changes plus this session's catalog/pricing changes. No commit was created.

| File | Change |
| ---- | ------ |
| `src/services/cloudgpt/get-models.ts` | New static CloudGPT model catalog service, returning `ModelsResponse` with all 76 active models from `cloudgpt_aoai.py`. |
| `src/routes/provider/models/route.ts` | Added built-in CloudGPT branch for provider-scoped model listing. |
| `src/routes/models/route.ts` | Added built-in CloudGPT branch for aggregated model listing. |
| `src/lib/token-usage/pricing.ts` | Added CloudGPT USD currency and best-effort built-in pricing/cached-input ratios. |
| `tests/cloudgpt-models.test.ts` | New catalog coverage tests. |
| `tests/models-route.test.ts` | Added CloudGPT static catalog route tests. |
| `tests/token-usage-pricing.test.ts` | New direct pricing resolver tests for CloudGPT. |
| `README.md`, `README.zh-CN.md` | Documented static CloudGPT model discovery and built-in USD pricing defaults. |

Validation evidence:

- `bun --eval ...` exact catalog verification: `pythonCount: 76`, `catalogCount: 76`, `missing: []`, `extra: []`.
- `bun test tests/cloudgpt-models.test.ts tests/models-route.test.ts tests/token-usage-pricing.test.ts` — passed, 10 tests.
- `bun run lint` — passed.
- `bun run typecheck --pretty false` — passed.
- `bun test` — passed: 398 pass, 0 fail, 1072 expectations across 48 files.
- `bun run build` — passed with existing tsdown `define` warning.
- `bun run build:desktop` — passed with existing tsdown `define` warning.
- `git --no-pager diff --check` — passed.

## Open tasks for the next agent

1. If a commit is requested, review `git --no-pager status --short` and decide whether to include `cloudgpt_aoai.py` and `conversations/` notes. Both remain untracked.
2. If more pricing precision is required later, confirm CloudGPT-internal billing for partner, image, video, and embedding models. This session used BaseLLM/OpenAI/Azure metadata best effort and omitted pricing where there was no credible exact source.
3. Optional future improvement: factor provider built-in model catalog routing into a shared helper if more providers gain static catalogs.

## Key decisions

| Decision | Rationale |
| -------- | --------- |
| Put catalog in `src/services/cloudgpt/get-models.ts` | Matches the existing `src/services/codex/get-models.ts` pattern for built-in provider model discovery and bundles cleanly with server/desktop builds. |
| Preserve CloudGPT helper endpoint comments as `supported_endpoints` | `cloudgpt_aoai.py` is the authoritative source for which models support Chat Completions, Responses, embeddings, images, or videos. |
| Do not call CloudGPT upstream `/v1/models` for CloudGPT | User reported no model catalog is available upstream; static routing makes model discovery deterministic. |
| Keep pricing in `src/lib/token-usage/pricing.ts` | Existing token usage accounting already resolves provider built-in pricing there. |
| Use best-effort pricing | Public metadata exists for most OpenAI/Azure/xAI/DeepSeek/Kimi/Llama text models, but not every CloudGPT-only image/video/future alias has credible exact pricing. |

## Blockers

- None for static catalog functionality.
- Exact CloudGPT-internal prices for some non-text/future models are not publicly confirmed.

## Suggested next step

Review the full diff for commit readiness, then commit the combined CloudGPT auth and static-catalog work if desired.
