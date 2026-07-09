# Handoff Note — 091426 · claude · complete-fork-publish

## Inherited context

Continues the same working session as `conversations/260709-review-refactor-translation/091205-claude-refactored-translation.md` (multi-agent review of commit 739271e, split of the translation monolith into `src/routes/translation/`, ~17 bug fixes, full validation and live E2E). That note's context is prerequisite reading. Earlier CloudGPT/translation background lives in `conversations/260707-cloudgpt-provider/` and `conversations/260707-chat-responses-claude-translation/`.

Locked-in decisions inherited: CloudGPT uses `authType: "azure-cli"` (no stored apiKey); translation modules live in `src/routes/translation/`; explicit per-model `models.<id>.type` config always wins; handoff notes live in project-root `conversations/`.

## Work done this session (after the refactor note)

- [x] **Merged upstream** `caozhiyuan/copilot-api` dev (11 commits, v1.13.17→v1.13.19) as merge commit `1803233`. One conflict in `src/routes/provider/responses/handler.ts` (kept our translation imports, took upstream's new gated `applyResponsesApiContextManagement(payload, maxPromptTokens, {compactThresholdRatio, source})` API). Also adapted the same call in `src/routes/provider/chat-completions/handler.ts` to the new signature with `source: "responses"` — the merge alone would not have caught that stale call. 433 tests green post-merge.
- [x] **Per-model CloudGPT endpoint routing** (`e3b1bc3`): `cloudgpt_aoai.py` annotates per-model endpoints, so a single provider type can never be right. Added `getCloudGptModelProviderType(modelId, preferredTypes)` to `src/services/cloudgpt/get-models.ts`; `resolveEffectiveProviderType/Config` in `src/lib/config.ts` consult it for cloudgpt when no explicit model config exists, with an optional protocol preference (`/v1/responses` handler passes `["openai-responses", "openai-compatible"]` so dual-endpoint models get native passthrough). Onboarding no longer prompts for provider type (`editableType: false` in `src/lib/quick-providers.ts` and `desktop/src/pages/AuthPage.tsx`). Live-verified: chat→Responses translation for `gpt-5.1-codex-mini` (Responses-only), native `/v1/responses` passthrough for `gpt-4.1-nano`, native chat for `DeepSeek-V3.2` — all with a bare config, no overrides. 439 tests.
- [x] **Diagnosed the "hang after onboarding"** the user reported: not a bug — they ran `bun run dev -- auth login --provider cloudgpt`, and the `dev` script is `bun run --watch`, which never exits by design. Verified the auth flow exits cleanly (<1s) under real PTYs (`script(1)` + FIFO-held stdin) for bun, node dist, direct-provider, and picker flows. Ruled out: consola prompt stdin leaks, logger intervals (unref'd), models/session refresh timers (server-start only). Use `bun run start -- auth ...` or `bun run ./src/main.ts auth ...` for one-off commands.
- [x] **Verified Anthropic Messages → Responses coverage for Responses-only CloudGPT models** (user question): the pre-existing translator (`src/routes/messages/responses-translation.ts` + `responses-stream-translation.ts`, built for codex) has a generic non-codex branch and is auto-selected by the catalog routing. Live-verified with `cloudgpt/gpt-5.1-codex-mini`: non-stream, streaming tool call, and multi-turn with thinking replay (`encrypted_content@rs_id` signature scheme survived the round trip, `SECRET=RAVEN-7429`). Web research (subagent) confirmed this repo's approach is the most complete public Anthropic→Responses implementation; LiteLLM's bridge has known multi-turn reasoning gaps we don't share.
- [x] Probed two Copilot-isms that leak to CloudGPT and found both harmless: the unconditional `phase: "commentary"/"final_answer"` field on replayed assistant messages (Azure ignores it, HTTP 200), and `gpt5CommentaryPrompt` injection for `gpt-5.3+` names (probed on `gpt-5.3-codex`, 200 + exact output; codex models are harmony-trained so it is semantically reasonable).
- [x] **Published the fork to npm** as `@hrz6976/copilot-api@1.13.19` (`9dc8f43` renames name/homepage/bugs/repository). Publish required the user's npm 2FA (web-auth flow); verified live with `npm exec -y @hrz6976/copilot-api@latest -- --help`. Note: registry CDN briefly served a cached 404 right after publish — wait/cachebust before concluding a publish failed.
- [x] **Updated docs and workflows for the fork** (`1ce6f81`): both READMEs now reference `@hrz6976/copilot-api` (20 refs each) and the fork's repo links, with a fork notice crediting upstream; deleted `release-docker.yml` and `release-desktop.yml` (fork publishes npm only); `release.yml` untouched — it already publishes via npm trusted publishing (OIDC, `id-token: write`, tokenless), which the user configured on npmjs for this package.

## Current state

Branch `dev`, clean tree except untracked `cloudgpt_aoai.py` (deliberately unversioned reference file). Everything pushed to `origin/dev` (`github.com/hrz6976/copilot-api`). npm package `@hrz6976/copilot-api@1.13.19` live with tag `latest`.

| Commit | Content |
| ------ | ------- |
| `1b57a7a` | Translation module split + review fixes (see prior note) |
| `1803233` | Upstream merge v1.13.17–v1.13.19 + context-management API adaptation |
| `e3b1bc3` | CloudGPT per-model catalog routing, no type prompt |
| `9dc8f43` | Package rename to `@hrz6976/copilot-api` |
| `1ce6f81` | README fork refs + fork notice; docker/desktop workflows removed |

Release flow: `bumpp && git push --follow-tags` → `release.yml` runs lint/typecheck/tests/build, creates the GitHub release (changelogithub), publishes to npm via trusted publishing. Pre-release tags (`v*-beta.N`) map to the matching npm dist-tag.

## Open tasks for the next agent

1. Deferred review findings from the prior note remain open: no client-abort propagation in streaming pumps, no SSE error on mid-stream iterator throws, SSE pump scaffolding could unify into one helper, `applyProviderModelDefaults` `??=` blocks extraBody fills, CLI/desktop `buildProviderConfig` duplication, builtin-provider name-check chains could become a registry.
2. Optional cleanliness: gate `shouldApplyPhase` (currently unconditional, `src/routes/messages/responses-translation.ts:408`) and the `gpt5CommentaryPrompt` default (`src/lib/config.ts:436`, matched by `isGpt53OrAbove`) to the copilot/codex providers. Both verified harmless on CloudGPT, so this is polish, not a bug.
3. `modelResponsesApiCompactThresholds` config keys match exactly; entries like `"gpt-5.4"` do not apply to CloudGPT's date-suffixed `gpt-5.4-20260305`. Consider prefix matching if users want per-model thresholds for CloudGPT.
4. Upstream merges will now conflict on: README package-name refs, the two deleted workflow files, and `package.json` name — resolve by keeping the fork's versions.
5. If a release is desired, bump the version past 1.13.19 first (that version is already published; trusted publishing will reject a republish).

## Key decisions

| Decision | Rationale |
| -------- | --------- |
| Route CloudGPT per model from the builtin catalog; drop the type prompt | `cloudgpt_aoai.py` shows endpoints are a per-model property (pro/codex models are Responses-only; DeepSeek/gpt-oss chat-only) — no single provider type is correct. Explicit model config still overrides. |
| `/v1/responses` prefers native passthrough (`openai-responses` first) for dual-endpoint models | Avoids lossy translation when the model speaks the endpoint natively; chat-only models keep the Chat fallback. |
| Adapted (not just merged) the upstream context-management API in the chat handler | Upstream changed the function signature; our Chat→Responses branch called the old shape and would have silently miscompiled the merge. |
| Fork publishes npm only; docker/desktop workflows deleted rather than disabled | Matches the user's stated scope; deletion states intent clearly. Expect merge conflicts when upstream edits those files. |
| Kept `release.yml` unchanged | It already implements npm trusted publishing (OIDC), matching the user's npmjs configuration. |
| Left `phase`/commentary Copilot-isms in place after probing | Both accepted by CloudGPT upstream with correct outputs; gating them is optional polish tracked in Open tasks. |

## Blockers

- (none)

## Suggested next step

If cutting the first fork release from source: bump version (e.g. 1.13.20 or 1.14.0), push the tag, and confirm the trusted-publishing run succeeds end to end; otherwise pick up the deferred streaming-pump cleanups from Open tasks item 1.
