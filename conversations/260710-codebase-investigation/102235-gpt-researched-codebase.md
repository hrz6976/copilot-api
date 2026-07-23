# Handoff Note — 102235 · gpt · researched-codebase

## Inherited context

- The newest pre-existing handoff thread, `conversations/260710-upstream-release-sync/`, did not match this repository-wide investigation, so this thread was created.
- An older relevant note, `conversations/260709-repository-investigation/091540-gpt-researched-repository.md`, had already inventoried the repository at a high level and identified the Python CloudGPT catalog as a helper/reference rather than published runtime code.

## Work done this session

- [x] Spawned three read-only agents to investigate core API architecture, provider/auth/security paths, and tests/build/desktop/plugin surfaces.
- [x] Mapped CLI bootstrap, Hono middleware/routes, model/provider dispatch, protocol translation, upstream transports, and token-usage persistence.
- [x] Audited Copilot, Codex OAuth, CloudGPT Azure CLI, generic provider authentication, proxy/TLS behavior, and security-sensitive endpoints.
- [x] Audited root and desktop quality gates, CI/release workflows, plugins, README consistency, and the static usage viewer.
- [x] Ran `bun run typecheck` successfully.
- [x] Ran `bun test`: 464 passed, 0 failed, 1,318 assertions across 53 files in 14.82 seconds.
- [ ] No fixes were requested or made.

## Current state

No product files were changed. The pre-existing untracked files shown by `git status` were preserved.

| File | Change |
| --- | --- |
| `conversations/260710-codebase-investigation/102235-gpt-researched-codebase.md` | Added this investigation handoff note. |

Key architecture: `src/main.ts` dynamically applies CLI environment overrides before importing modules; `src/start.ts` initializes config, identity, credentials, providers, and caches before mounting `src/server.ts`; Hono routes support OpenAI Chat/Responses, Anthropic Messages, native Copilot, Codex, CloudGPT, and custom providers. Model mappings plus `provider/model` aliases select the backend and provider protocol adapters translate where native passthrough is unavailable.

## Open tasks for the next agent

1. Harden default network exposure: bind loopback by default or require explicit public mode, protect/remove `/token`, require an explicit unauthenticated mode, and narrow CORS.
2. Make Codex token refresh single-flight and add a concurrency/refresh-token-rotation test, following the existing CloudGPT shared-promise pattern.
3. Validate provider base URLs and require HTTPS by default; harden config and verbose-log permissions to `0600`/`0700` with atomic config writes.
4. Change Codex inbound header forwarding from a denylist to a documented allowlist.
5. Fix `plugin/claude/tool-search/.mcp.json` to launch `@hrz6976/copilot-api`, then add plugin syntax/manifest checks to CI.
6. Add desktop install/lint/`tsc -b`/test/build gates to CI and enforce the stated 85% changed-code coverage threshold.
7. Self-host or bundle usage-viewer dependencies and avoid persistent gateway-key storage in `localStorage`; add CSP/SRI if external scripts remain.
8. Reconcile contradictory desktop release documentation and clarify that root `build:desktop` builds the server bundle, not the Electron app/installer.

## Key decisions

| Decision | Rationale |
| --- | --- |
| Rank default exposure as the highest-priority finding | Empty API-key defaults allow non-admin routes, wildcard CORS is enabled, `/token` returns the live Copilot bearer, and `srvx` listens on all interfaces when hostname is omitted. |
| Treat the overall test posture as strong for API protocol behavior but incomplete for auxiliary surfaces | The root suite passed 464 tests and deeply exercises translation/routing/error paths, while desktop UI/IPC/packaging, plugins, and the usage viewer have little or no direct gating. |
| Preserve all pre-existing untracked files | The task was investigation-only and those files belong to existing user work. |

## Blockers

- None.

## Suggested next step

Start with a narrowly scoped security patch that makes the server loopback-only by default and protects `/token`, accompanied by request-auth/server binding tests.
