# Handoff Note — 071211 · gpt · continue-refresh

## Inherited context

Read all prior notes in `conversations/260707-cloudgpt-provider/`:

- `071115-gpt-continue-cloudgpt.md`: CloudGPT was registered as a quick provider using base URL `https://cloudgpt-openai.azure-api.net/openai`, default type `openai-compatible`, and static bearer token in `apiKey`.
- `071116-gpt-researched-aad.md`: Microsoft/Azure docs confirm short-lived access tokens; default Entra access-token lifetime is usually 60-90 minutes, refresh tokens are longer-lived but Azure CLI/MSAL should manage those details.
- `071118-gpt-verified-token.md`: Local Azure CLI successfully obtained a CloudGPT-scoped token for tenant `72f988bf-86f1-41af-91ab-2d7cd011db47` and scope `api://feb7b661-cac7-44a8-8dc1-163b63c23df2/.default`; `/openai/ping` returned `OK` with HTTP 200. The token itself was not printed.

## Work done this session

- [x] User accepted the brainstormed design for keeping CloudGPT tokens valid in a long-running proxy.
- [x] Decision: implement CloudGPT as a dynamic-token provider rather than asking users to paste short-lived AAD access tokens into `config.json`.
- [x] Preferred first implementation: use Azure CLI as the token source because the local environment is already authenticated and validation has succeeded.
- [ ] Implement dynamic Azure CLI token resolution and early refresh.
- [ ] Update tests and docs.
- [ ] Re-run validation.

## Current state

No code changes have been made in this session yet beyond this handoff note. Existing uncommitted CloudGPT provider-registration changes from prior work remain in the worktree.

Target implementation direction:

| Surface | Intended change |
| ------- | --------------- |
| `src/lib/config.ts` | Add a provider auth type or config shape for CloudGPT/Azure CLI dynamic auth, preserving existing provider behavior. |
| `src/lib/provider-resolver.ts` | Resolve `cloudgpt` to a fresh bearer token at request time, refreshing before expiry. |
| New helper under `src/lib/` | Run `az account get-access-token --tenant ... --scope ... -o json`, parse `accessToken` and expiry, cache in memory, and singleflight concurrent refreshes. |
| `src/lib/quick-providers.ts` | Make CloudGPT quick setup write dynamic auth metadata instead of requiring a pasted short-lived token if possible. |
| `src/auth.ts` and desktop provider setup | Adjust CloudGPT auth UX so users are not asked to paste an access token unnecessarily; likely prompt/assume Azure CLI auth. |
| Tests | Mock Azure CLI token output and verify refresh/headers without logging tokens. |
| Docs | Document `az login --tenant ...`, dynamic refresh, and error behavior. |

## Open tasks for the next agent

1. Inspect current provider config/type handling in `src/lib/config.ts`, `src/lib/provider-resolver.ts`, `src/services/providers/provider-proxy.ts`, `src/auth.ts`, and desktop provider auth files before editing.
2. Design a minimally invasive config representation for dynamic CloudGPT auth. Avoid breaking existing `authorization`, `x-api-key`, and `oauth2` behavior.
3. Implement an in-memory Azure CLI token manager:
   - command: `az account get-access-token --tenant 72f988bf-86f1-41af-91ab-2d7cd011db47 --scope api://feb7b661-cac7-44a8-8dc1-163b63c23df2/.default -o json`
   - parse `accessToken`, `expires_on`, `expiresOn`, `tokenType`, `tenant`
   - refresh when token is missing or within a safety window (recommended: 5 minutes)
   - use singleflight so concurrent requests share one refresh promise
   - never log token values
4. Ensure CloudGPT upstream requests still use `Authorization: Bearer <fresh-token>` through existing proxy header code.
5. Update CLI and desktop quick-provider flows so CloudGPT setup validates/configures Azure CLI dynamic auth without requiring a short-lived token as `apiKey`.
6. Add tests:
   - token helper parses Azure CLI JSON and caches until near expiry
   - near-expiry token triggers refresh
   - concurrent calls singleflight
   - `resolveProviderConfig("cloudgpt")` injects dynamic token
   - provider headers use bearer auth
7. Run targeted tests, typecheck, lint, and relevant build if affected.
8. Write a closing handoff note after implementation.

## Key decisions

| Decision | Rationale |
| -------- | --------- |
| Use Azure CLI as initial token source | Local `az` is authenticated and already validated against CloudGPT; avoids adding a full MSAL/Azure Identity flow immediately. |
| Do not persist acquired access tokens to `config.json` | Tokens are short-lived sensitive credentials and will expire while the proxy is running. |
| Refresh before expiry | Avoids request failures near token expiration; 5 minutes is a practical safety window. |
| Singleflight refresh | Prevents many simultaneous upstream requests from spawning many `az` processes. |
| Surface clear refresh failures | Long-running proxy should tell users to run `az login --tenant ...` when CLI auth expires or lacks access. |

## Blockers

- Need to verify how much the current config schema can evolve without disrupting desktop/CLI provider setup.
- Need to choose exact auth type name during implementation, e.g. `azure-cli` or `azure-ad`.

## Suggested next step

Inspect the provider config/resolver/auth setup and implement the smallest dynamic CloudGPT Azure CLI token manager that preserves existing provider behavior.
