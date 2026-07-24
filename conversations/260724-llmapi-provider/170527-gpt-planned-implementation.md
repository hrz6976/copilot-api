# Handoff Note — 170527 · gpt · planned-implementation

## Inherited context

The user supplied `llmapi_client.py` and later `anthrophic.py` as reference clients for Microsoft LLM API. The goal is to add LLM API support to this Bun/TypeScript gateway while preserving its OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages client interfaces.

Earlier testing incorrectly concluded that the account lacked model entitlement because model names were sent without the environment-qualified `dev-` prefix. That conclusion is invalid. Live tests now prove that the account, public client, endpoint, and at least two protocol paths work.

## Verified live behavior

### Authentication

- Public client ID: `68df66a4-cad9-4bfd-872b-c6ddde00d6b2`
- Tenant: `72f988bf-86f1-41af-91ab-2d7cd011db47`
- Scope: `https://substrate.office.com/llmapi/LLMAPI.dev`
- Base URL: `https://fe-26.qas.bing.net/sdf/`
- Python MSAL broker authentication succeeds on Windows.
- Azure CLI authentication must not be reused: its client application is not preauthorized for the LLM API resource and returns `AADSTS65002`.
- Device code was previously tested but is unavailable to the user.

### Model naming

Dev requests require environment-qualified model IDs:

- Wrong: `anthropic-claude-sonnet-4-5` -> HTTP 403 `No access found for model`
- Correct: `dev-anthropic-claude-sonnet-4-5` -> HTTP 200
- Wrong: `mai-code-1-flash` -> HTTP 403
- Correct: `dev-mai-code-1-flash` -> reaches inference and returns HTTP 200 with a compatible payload

The proxy must preserve these exact upstream IDs. It must not add, remove, or otherwise rewrite the `dev-` prefix. Users who want shorter names should configure the existing global `modelMappings`, for example:

```json
{
  "modelMappings": {
    "claude-sonnet-4-5": "llmapi/dev-anthropic-claude-sonnet-4-5",
    "mai-code": "llmapi/dev-mai-code-1-flash"
  }
}
```

`resolveMappedModel` already runs before provider alias parsing on top-level Messages, Responses, Chat Completions, and token-count routes, so no new alias mechanism is needed.

### Anthropic Messages

`POST https://fe-26.qas.bing.net/sdf/messages`

Required request details:

- `Authorization: Bearer <token>`
- `X-ModelType: dev-anthropic-claude-*`
- `anthropic-version: 2023-06-01`
- Four taxonomy headers listed below
- Native Anthropic Messages JSON body

Verified:

- `dev-anthropic-claude-opus-4-1` streams successfully.
- Stream events include `message_start`, `content_block_start`, `ping`, `content_block_delta`, `content_block_stop`, `message_delta`, and `message_stop`.
- A smoke prompt returned `model-ok`.
- `dev-anthropic-claude-sonnet-4-5` succeeds non-streaming.

### OpenAI Chat Completions

`POST https://fe-26.qas.bing.net/sdf/chat/completions`

Verified:

- `dev-mai-code-1-flash` succeeds non-streaming and streaming.
- Response model is reported as `mai-2-coding-fast`.
- Streaming is standard OpenAI SSE and ends with `data: [DONE]`.
- This model requires `max_completion_tokens`.
- It rejects `max_tokens`.
- It rejects `stop`.

### OpenAI Responses

Not verified.

`dev-gpt-56-reasoning-sol-oai-standard` passed model authorization after adding `dev-`, but `POST /sdf/responses` returned an empty HTTP 404. Do not claim Responses support or build it into the first live acceptance gate until the correct upstream route and request contract are confirmed.

### Required taxonomy headers

```text
X-Taxonomy-Experience: AppCopilots
X-Taxonomy-Agent: LLMAPISampleApp
X-Taxonomy-InferenceStep: InferenceTest
X-Taxonomy-TrafficType: Test
```

## Architectural decision

Implement LLM API as a **provider transport/authentication mode**, not as a fourth request/response protocol.

The existing provider `type` must continue to select semantic protocol:

- `anthropic`
- `openai-compatible`
- `openai-responses` after its upstream path is verified

LLM API changes:

- authentication;
- upstream URL layout;
- model selection through `X-ModelType`;
- required taxonomy headers;
- selected model payload compatibility.

This design reuses all existing Chat/Messages/Responses translators and avoids duplicating protocol handling.

Proposed configuration shape:

```json
{
  "providers": {
    "llmapi": {
      "transport": "llmapi",
      "authType": "llmapi-broker",
      "baseUrl": "https://fe-26.qas.bing.net/sdf",
      "pricingCurrency": "USD"
    }
  },
  "modelMappings": {
    "claude-sonnet-4-5": "llmapi/dev-anthropic-claude-sonnet-4-5",
    "mai-code": "llmapi/dev-mai-code-1-flash"
  }
}
```

Like CloudGPT, LLM API should have a built-in static catalog keyed by exact upstream model ID. Catalog entries should contain protocol/endpoints, capabilities, payload compatibility, and pricing when verified. User `providers.llmapi.models` entries remain optional overrides using the existing `ModelConfig` mechanism.

### CloudGPT precedent investigated

- `src/services/cloudgpt/get-models.ts` stores exact upstream model IDs and endpoint/capability metadata in a static catalog.
- `getCloudGptModelProviderType` derives Chat Completions versus Responses routing from catalog endpoints.
- `/cloudgpt/v1/models` returns those exact IDs; aggregated `/v1/models` prefixes only the provider name (`cloudgpt/<exact-id>`).
- `modelMappings` performs exact source-to-target rewrites before `provider/model` parsing.
- CloudGPT token pricing is currently held in `src/lib/token-usage/pricing.ts`, keyed by exact provider/model ID. It is not currently emitted by `/v1/models`.

For LLM API, use one catalog as the source of truth and extend model metadata to return known `pricing` and `pricing_currency`. The token-usage resolver should consume the same catalog pricing through a helper rather than duplicating an independent LLM API pricing table. Never invent rates: omit pricing fields for entries whose rates have not been verified.

## Implementation plan

### Phase 1: prove MSAL Node broker compatibility

Before changing provider routing, create a minimal temporary TypeScript spike using:

- `@azure/msal-node`
- `@azure/msal-node-extensions`
- `NativeBrokerPlugin`
- `PublicClientApplication`

Use the verified client ID, authority, and scope. Prove all of the following under Bun:

1. Native broker interactive acquisition works.
2. The returned token can call one verified LLM API model.
3. `acquireTokenSilent` works afterward.
4. Encrypted persistence works with `PersistenceCreator` and `PersistenceCachePlugin`.
5. A second process can load the persisted account and silently acquire a token.

Use `DataProtectionScope.CurrentUser` on Windows. Do not use plaintext persistence. Remove the temporary spike after extracting tested production helpers.

If the native extension cannot load under Bun, test the same packaged code under the project's supported Node runtime. Do not silently fall back to Azure CLI or an unencrypted cache. Report the runtime incompatibility before selecting a different auth design.

### Phase 2: dependencies and credential paths

Update `package.json` through Bun:

```powershell
bun add @azure/msal-node @azure/msal-node-extensions
```

Add a dedicated LLM API MSAL cache path to `src/lib/paths.ts`, for example:

```text
<APP_DIR>/llmapi_msal_cache.bin
```

Do not put access tokens in `config.json`. The encrypted MSAL cache is the credential store.

### Phase 3: typed configuration

Update `src/lib/config.ts`:

- Add a typed provider transport, likely `"standard" | "llmapi"`, with `"standard"` as the behavior-preserving default.
- Add `transport?: ProviderTransport` to `ProviderConfig`.
- Add resolved `transport: ProviderTransport` to `ResolvedProviderConfig`.
- Add `"llmapi-broker"` to `ProviderAuthType`.
- Permit `llmapi-broker` only for provider `llmapi` with transport `llmapi`; warn and fall back or reject consistently with current config conventions.
- Exempt valid LLM API broker configuration from `apiKey` requirements.
- Preserve model-level `type` overrides so each LLM API model selects its native semantic protocol.
- Route built-in LLM API models from catalog metadata before falling back to provider-level type, following `getCloudGptModelProviderType`.
- Keep user model-level `type`, payload, and pricing overrides higher priority than built-in catalog metadata.

Update config tests for:

- default transport;
- valid LLM API config without `apiKey`;
- invalid use of `llmapi-broker` by another provider;
- model-level type resolution;
- no regression to Codex OAuth2 or CloudGPT Azure CLI resolution.

### Phase 4: LLM API authentication module

Create a focused module such as `src/lib/llmapi-token.ts`.

Responsibilities:

- Define client ID, authority, scope, cache metadata, and refresh window constants.
- Construct the encrypted persistence plugin and MSAL public client.
- List cached accounts and select the account saved by login.
- Acquire tokens silently at runtime.
- Deduplicate concurrent token refreshes.
- Never start interactive login from an HTTP request.
- Return an actionable error:

```text
LLM API credentials not found or expired. Run `copilot-api auth login --provider llmapi`.
```

- Provide a login function that explicitly invokes broker interaction.
- Never log or serialize the access token outside the encrypted MSAL cache.
- Expose reset/injection seams needed for deterministic unit tests.

Test:

- cached account selection;
- silent success;
- silent refresh;
- concurrent request deduplication;
- missing-account error;
- interaction-required error;
- broker login persistence;
- secret redaction.

Mock the MSAL boundary; live broker tests must remain manual smoke tests.

### Phase 5: CLI onboarding

Update:

- `src/auth.ts`
- `src/lib/quick-providers.ts`
- related auth and quick-provider tests

Add `llmapi` to provider selection and labels. `copilot-api auth login --provider llmapi` should:

1. initialize encrypted persistence;
2. run native broker login;
3. verify an account/token was persisted;
4. write/update `providers.llmapi` without an API key;
5. preserve existing per-model overrides and global `modelMappings`;
6. print a success message without printing the token.

Quick-provider defaults:

- provider name: `llmapi`
- `transport: "llmapi"`
- default type: choose `openai-compatible` only as a fallback; real routing should be per-model
- base URL: `https://fe-26.qas.bing.net/sdf`
- auth type: `llmapi-broker`
- no API key
- pricing currency: `USD`

Seed the built-in catalog with exact upstream IDs whose contracts have been live-verified:

- `dev-anthropic-claude-opus-4-1` -> `anthropic`
- `dev-anthropic-claude-sonnet-4-5` -> `anthropic`
- `dev-mai-code-1-flash` -> `openai-compatible`

Expand the catalog only from reviewed source data. Unverified Responses models may be listed with accurate metadata only if clearly disabled from request routing; otherwise omit them from the first implementation.

### Phase 6: provider resolution

Update `src/lib/provider-resolver.ts`:

- Detect `providerConfig.transport === "llmapi"` and `authType === "llmapi-broker"`.
- Acquire a silent LLM API token.
- Return the token as the resolved in-memory credential used by the transport.
- Preserve explicit broker auth semantics across model-level protocol overrides. The current logic recomputes auth type when `type` changes; ensure it does not replace `llmapi-broker` with `x-api-key` or `authorization`.

Add resolver tests analogous to CloudGPT tests, but mock the LLM API token module rather than invoking a broker.

### Phase 7: transport implementation

Refactor `src/services/providers/provider-proxy.ts` surgically.

Add transport-aware helpers rather than scattering `providerConfig.name === "llmapi"` checks:

```text
buildProviderUpstreamHeaders(...)
resolveProviderUpstreamUrl(...)
prepareProviderPayload(...)
```

For LLM API:

- `/v1/messages` becomes `/messages`.
- `/v1/chat/completions` becomes `/chat/completions`.
- `/v1/responses` must remain disabled until verified.
- Remove `model` from the JSON body.
- Set `X-ModelType` to the exact model ID received after provider alias parsing.
- Do not add or remove `dev-`.
- Add `Authorization: Bearer <token>`.
- Add taxonomy headers.
- Add `anthropic-version: 2023-06-01` for Messages, preserving a valid inbound version only if that behavior is explicitly desired.
- Keep `Accept`, `User-Agent`, and SSE response forwarding behavior consistent with current providers.

Do not mutate the caller's payload object while removing `model`; clone it so logging and usage accounting retain the exact requested upstream model ID.

For model payload compatibility:

- Reuse `applyGptModelTokenLimitParam` if it correctly converts `max_tokens` to `max_completion_tokens` for `dev-mai-code-1-flash`.
- Otherwise add a typed catalog compatibility profile and a payload normalization helper under `src/lib/provider-payload.ts`.
- Remove only explicitly configured unsupported fields such as `stop`.
- Do not broadly strip unknown fields.

Error handling:

- Preserve structured upstream JSON errors.
- For empty/non-JSON upstream errors, include HTTP status and provider/model context through existing `HTTPError` behavior.
- Never turn HTTP 404/403/500 into success-shaped responses.

### Phase 8: route integration

The existing handlers should continue to own translation:

- `src/routes/provider/messages/handler.ts`
- `src/routes/provider/chat-completions/handler.ts`
- `src/routes/provider/responses/handler.ts`

Expected flows:

1. `/v1/messages`, model `llmapi/dev-anthropic-claude-sonnet-4-5`
   - provider alias parsed;
   - effective type `anthropic`;
   - native Anthropic payload forwarded to LLM API `/messages`;
   - native response/stream returned.

2. `/v1/chat/completions`, model `llmapi/dev-mai-code-1-flash`
   - effective type `openai-compatible`;
   - payload normalized;
   - forwarded to LLM API `/chat/completions`;
   - native OpenAI response/stream returned.

3. `/v1/chat/completions`, model `llmapi/dev-anthropic-claude-sonnet-4-5`
   - existing Chat-to-Anthropic translation;
   - LLM API `/messages`;
   - existing Anthropic-to-Chat translation.

4. `/v1/messages`, model `llmapi/dev-mai-code-1-flash`
   - existing Anthropic-to-Chat translation;
   - LLM API `/chat/completions`;
   - existing Chat-to-Anthropic translation.

Do not enable `/v1/responses` for LLM API until its upstream contract is verified. Return the existing clear unsupported-endpoint error rather than forwarding to a known-bad path.

Review `src/routes/provider/messages/count-tokens-handler.ts` so LLM API aliases use existing local estimation or supported translation behavior and never attempt an unverified upstream token-count route.

Also test a friendly alias such as `claude-sonnet-4-5` mapped to `llmapi/dev-anthropic-claude-sonnet-4-5`; routing should be completed entirely by existing `modelMappings` before entering provider handlers.

### Phase 9: model listing

LLM API has no verified model-list endpoint.

Update:

- `src/routes/provider/models/route.ts`
- `src/routes/models/route.ts`

Create `src/services/llmapi/get-models.ts` following the CloudGPT catalog pattern. Do not acquire a broker token merely to list static models.

Return exact upstream IDs:

- provider-scoped: `dev-anthropic-claude-sonnet-4-5`
- aggregated: `llmapi/dev-anthropic-claude-sonnet-4-5`

Each catalog model should provide:

- exact `id` used as `X-ModelType`;
- display name, vendor, family, and version;
- capabilities and token limits when verified;
- `supported_endpoints`;
- semantic provider type used for routing;
- typed payload compatibility profile;
- pricing and currency when verified.

Extend the public `Model` interface with optional `pricing` and `pricing_currency` metadata and preserve those fields through `normalizeProviderModel`. Aliases from `modelMappings` should not replace or duplicate catalog entries in `/v1/models`; mappings are request routing configuration, not upstream model identity.

### Phase 10: focused tests

Add or extend tests covering at least:

1. Header construction:
   - bearer token;
   - taxonomy headers;
   - Anthropic version;
   - no secret leakage.

2. URL construction:
   - `/messages`;
   - `/chat/completions`;
   - no accidental `/v1`;
   - normalized trailing slash.

3. Model identity:
   - forwards exact `dev-*` ID unchanged;
   - never accepts an unprefixed name by silently rewriting it;
   - routes a friendly name only when `modelMappings` explicitly targets `llmapi/dev-*`;
   - records usage under the exact upstream model ID.

4. Payload normalization:
   - removes body `model`;
   - converts token-limit parameter only when required;
   - strips configured unsupported `stop`;
   - does not mutate the source payload.

5. Non-streaming proxy:
   - Anthropic native response;
   - MAI OpenAI response;
   - structured errors;
   - empty upstream errors.

6. Streaming proxy:
   - native Anthropic event sequence;
   - OpenAI chunks and `[DONE]`;
   - translated Chat/Messages aliases;
   - usage recording.

7. Models:
   - provider-scoped static list;
   - exact provider-scoped `dev-*` IDs;
   - aggregated `llmapi/dev-*` IDs;
   - endpoint/protocol metadata;
   - known pricing metadata;
   - model listing does not call MSAL.

8. CLI and resolver:
   - login selection;
   - config persistence;
   - silent token resolution;
   - missing credentials message.

Changed production code must meet the repository's 85% coverage requirement.

### Phase 11: documentation

Update `README.md`:

- Add LLM API to supported providers.
- Document Windows native broker requirement and encrypted cache.
- Document `auth login --provider llmapi`.
- Explain that exact upstream `dev-*` IDs are preserved.
- Show optional `modelMappings` aliases targeting `llmapi/dev-*`.
- Explain per-model semantic `type`.
- Include working Messages and Chat Completions configuration examples.
- State that Responses upstream support is not yet verified.
- Document that no API key is stored in configuration.

### Phase 12: validation

Run:

```powershell
bun test <targeted llmapi tests>
bun test
bun run lint:all
bun run typecheck
bun run build
```

Then run live acceptance tests:

1. `copilot-api auth login --provider llmapi`.
2. Restart the process and prove silent token acquisition.
3. Native Anthropic non-stream through local provider alias.
4. Native Anthropic stream through local provider alias.
5. Native MAI Chat Completions non-stream.
6. Native MAI Chat Completions stream ending in `[DONE]`.
7. Top-level `/v1/chat/completions` translated to Anthropic.
8. Top-level `/v1/messages` translated to MAI Chat Completions.
9. `/v1/models` includes exact `llmapi/dev-*` catalog models and known pricing without interactive auth.
10. A configured friendly `modelMappings` alias routes to the exact `llmapi/dev-*` model.
11. Remove/expire credentials and confirm the server emits the actionable login error without opening UI.

## Files expected to change

| File | Purpose |
| --- | --- |
| `package.json`, `bun.lock` | Add MSAL Node and native extension dependencies |
| `src/lib/paths.ts` | LLM API encrypted cache path |
| `src/lib/config.ts` | Transport/auth/model compatibility types and resolution |
| `src/lib/llmapi-token.ts` | Broker login, encrypted cache, silent refresh |
| `src/lib/provider-resolver.ts` | Resolve LLM API runtime bearer token |
| `src/lib/quick-providers.ts` | LLM API onboarding defaults |
| `src/lib/provider-payload.ts` | Narrow model payload normalization if needed |
| `src/services/llmapi/get-models.ts` | Exact upstream model catalog, routing metadata, capabilities, and known pricing |
| `src/services/copilot/get-models.ts` | Optional model pricing metadata returned by model discovery |
| `src/services/providers/provider-proxy.ts` | LLM API URLs, headers, body model removal |
| `src/auth.ts` | `auth login --provider llmapi` |
| `src/routes/provider/models/route.ts` | Static exact-ID provider model list |
| `src/routes/models/route.ts` | Aggregated `llmapi/dev-*` model list |
| `src/lib/token-usage/pricing.ts` | Resolve LLM API pricing from catalog helper if current API cannot consume catalog pricing directly |
| provider route handlers | Only minimal transport-aware wiring if proxy abstraction is insufficient |
| `tests/*llmapi*.test.ts` and existing provider tests | Authentication, transport, routing, models, CLI |
| `README.md` | Configuration and usage |

## Current working tree

At handoff time:

- `llmapi_client.py` is modified to accept `--model`, default to `dev-mai-code-1-flash`, and use a compatible minimal request.
- `anthrophic.py` is untracked and was supplied by the user; do not delete or overwrite it.
- `__pycache__/` was generated during testing and then removed.
- No TypeScript provider implementation has started.

## Key decisions

| Decision | Rationale |
| --- | --- |
| LLM API is a transport, not a fourth semantic provider type | Existing translators already model Anthropic, Chat Completions, and Responses protocols |
| Preserve exact upstream model IDs end-to-end | CloudGPT catalogs and routes exact upstream IDs; implicit rewriting hides configuration errors and caused misleading test conclusions |
| Use existing `modelMappings` for friendly aliases | Mapping already occurs before provider parsing on all relevant top-level routes, so a second alias mechanism would duplicate behavior |
| Build an LLM API static catalog like CloudGPT | LLM API has no verified model-list endpoint, while routing, capabilities, compatibility, and pricing are model-specific |
| Use MSAL native broker plus encrypted persistence | Matches the successful reference authentication and avoids plaintext tokens |
| Never interactively authenticate during an HTTP request | Server requests must be deterministic and non-interactive |
| Do not reuse Azure CLI | Its client ID is not preauthorized for the LLM API resource |
| Do not ship Responses upstream support yet | `/sdf/responses` returned empty HTTP 404 and the correct contract is unknown |
| Seed only live-verified models initially | Avoid advertising models whose endpoint/payload behavior is unproven |

## Open questions for Claude review

1. Is `transport` the best config field name, or should LLM API be represented as a provider-specific adapter selected by provider name?
2. Should model compatibility be a typed profile in the built-in catalog rather than generic user-configurable fields?
3. Does `@azure/msal-node-extensions` load and broker correctly under Bun on all packaged targets, especially the desktop build?
4. Should LLM API initially be Windows-only because broker login is the only user-approved authentication flow?
5. What is the correct upstream endpoint and request contract for LLM API Responses models?
6. Should taxonomy values remain fixed defaults or become provider configuration fields?

## Recommended next step

Have Claude review this plan first. If accepted, begin only with Phase 1: prove MSAL Node native broker, encrypted persistence, restart-safe silent acquisition, and one live `dev-mai-code-1-flash` request under the actual Bun runtime. Do not modify provider routing until that spike passes.
