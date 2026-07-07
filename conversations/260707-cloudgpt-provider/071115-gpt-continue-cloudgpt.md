# Handoff Note — 071115 · gpt · continue-cloudgpt

## Inherited context

No prior project-root handoff notes existed. The user asked to read `cloudgpt_aoai.py` and register CloudGPT as a supported provider, then asked to log the session and research Azure AAD token generation, default lifespan, and refresh mechanism.

## Work done this session

- [x] Read `cloudgpt_aoai.py`.
- [x] Identified CloudGPT endpoint/auth behavior from the Python helper:
  - Azure OpenAI endpoint: `https://cloudgpt-openai.azure-api.net/openai/`
  - v1 API base URL in the Python helper: `https://cloudgpt-openai.azure-api.net/openai/v1/`
  - AAD scope: `api://feb7b661-cac7-44a8-8dc1-163b63c23df2/.default`
  - Tenant ID: `72f988bf-86f1-41af-91ab-2d7cd011db47`
  - Token validation ping: `https://cloudgpt-openai.azure-api.net/openai/ping`
- [x] Registered `cloudgpt` as a quick provider in the TypeScript gateway.
- [x] Updated CLI auth provider labels/help and desktop provider picker/types/locales.
- [x] Added tests for CLI quick-provider registration and desktop provider registration.
- [x] Updated README and README.zh-CN provider documentation.
- [x] Restored dependencies with `bun install` because validation initially failed from missing packages/tools.
- [x] Ran validation:
  - `bun test tests/quick-providers.test.ts tests/auth-login.test.ts desktop/tests/desktop-provider-auth.test.ts` passed.
  - `bun run typecheck --pretty false` passed.
  - `bun run lint` passed.
- [ ] Research Azure AAD token generation, default access-token lifespan, and refresh behavior.
- [ ] Decide whether to keep `cloudgpt` as a manual-token quick provider or implement automated AAD token acquisition/refresh.

## Current state

The repo has uncommitted changes for CloudGPT provider support. `cloudgpt_aoai.py` is untracked and appears to have been provided as the reference input.

| File | Change |
| ---- | ------ |
| `src/lib/quick-providers.ts` | Added `cloudgpt` quick-provider config with base URL `https://cloudgpt-openai.azure-api.net/openai`, default type `openai-compatible`, editable type, and USD pricing currency. |
| `src/auth.ts` | Added `cloudgpt` to CLI provider help/labels via quick-provider list. |
| `desktop/src/types/ipc.ts` | Added `cloudgpt` to `QuickProviderName`. |
| `desktop/src/pages/AuthPage.tsx` | Added CloudGPT defaults, color, label switch, and picker entry. |
| `desktop/src/locales/index.ts`, `desktop/src/locales/en.ts`, `desktop/src/locales/zh.ts` | Added `providerCloudgpt` localization key. |
| `tests/quick-providers.test.ts` | Added CloudGPT quick-provider defaults test. |
| `tests/auth-login.test.ts` | Added CloudGPT CLI auth config tests and updated unknown-provider expectation. |
| `desktop/tests/desktop-provider-auth.test.ts` | Added CloudGPT desktop config tests. |
| `README.md`, `README.zh-CN.md` | Documented CloudGPT in provider lists, auth options, quick-provider details, and pricing-currency defaults. |

## Open tasks for the next agent

1. Research official Azure/Microsoft documentation for how to generate AAD access tokens for an API scope like `api://feb7b661-cac7-44a8-8dc1-163b63c23df2/.default`.
2. Confirm default Microsoft Entra access-token lifetime and whether it varies/randomizes.
3. Confirm refresh-token lifetime/rotation behavior for Azure Identity credential flows.
4. If implementing automated refresh later, inspect existing auth/token abstractions before editing:
   - `src/lib/token.ts`
   - `src/lib/provider-resolver.ts`
   - `src/lib/config.ts`
   - `src/auth.ts`
   - desktop auth files under `desktop/electron/` and `desktop/src/pages/AuthPage.tsx`
5. Decide whether CloudGPT should remain a manual bearer-token provider or become a built-in OAuth/AAD provider with token cache and refresh.

## Key decisions

| Decision | Rationale |
| -------- | --------- |
| Registered CloudGPT as `openai-compatible` quick provider | `cloudgpt_aoai.py` uses Azure OpenAI/OpenAI client semantics and the gateway already supports OpenAI-compatible proxying. |
| Used base URL without `/v1` | `provider-proxy.ts` appends `/v1/chat/completions`, `/v1/responses`, and `/v1/models`; the Python helper's v1 URL maps to gateway base URL `https://cloudgpt-openai.azure-api.net/openai`. |
| Stored bearer token in `apiKey` with default `authorization` auth | Existing provider config sends `Authorization: Bearer ${apiKey}` for OpenAI-compatible providers, matching CloudGPT's AAD bearer-token requirement. |
| Did not implement AAD token acquisition/refresh yet | User requested registration first; token generation/lifetime/refresh still needs research. |

## Blockers

- Automated CloudGPT token refresh is not implemented. The current quick-provider setup depends on the user supplying a valid AAD bearer token as `apiKey`.

## Suggested next step

Research Microsoft Entra access/refresh token documentation, then decide whether to add a CloudGPT-specific AAD credential flow rather than treating CloudGPT as a manual-token quick provider.
