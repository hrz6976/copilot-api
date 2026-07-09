# Handoff Note — 091635 · gpt · verified-inferknock

## Inherited context

- User asked to test `inferknock/GLM-5.2`, then interrupted and asked to continue and also test `glm-5.2-fast`.
- No prior notes existed in `conversations/260709-inferknock-glm-test/`.

## Work done this session

- [x] Checked local config for `inferknock` with secrets redacted.
- [x] Confirmed configured provider currently uses `baseUrl: "https://api.interknock.ai"` and `type: "anthropic"`.
- [x] Confirmed `api.interknock.ai` does not resolve.
- [x] Confirmed `api.inferknock.ai` resolves and `/v1/models` is reachable.
- [x] Confirmed `/v1/models` lists `glm-5.2` and `glm-5.2-fast`, both with `supported_endpoint_types: ["openai"]`.
- [x] Tested current configured gateway path; it failed to connect because of the typoed host.
- [x] Tested corrected host/type through a temporary `COPILOT_API_HOME` without modifying real config.
- [x] Tested direct upstream calls to separate provider errors from gateway routing.

## Current state

No tracked repo files were changed. A new handoff folder/note was added under `conversations/260709-inferknock-glm-test/`.

| Target | Result |
| --- | --- |
| Current config `inferknock/GLM-5.2` via `/v1/messages` | Gateway routes to provider alias but fails DNS/connectivity: `api.interknock.ai` cannot resolve. |
| Corrected config `inferknock/GLM-5.2` via `/v1/chat/completions` | HTTP 403: token has no permission for model `GLM-5.2`. |
| Corrected config `inferknock/glm-5.2` via `/v1/chat/completions` | HTTP 503: `model_not_found`, no available distributor for `glm-5.2` in group `default`. |
| Corrected config `inferknock/glm-5.2-fast` via `/v1/chat/completions` | HTTP 500: `do_request_failed`, upstream request failed. |
| Corrected config `inferknock/glm-5.2` via `/v1/messages` | Same `model_not_found` after gateway Anthropic-to-OpenAI translation. |
| Corrected config `inferknock/glm-5.2-fast` via `/v1/messages` | Same `do_request_failed` after gateway Anthropic-to-OpenAI translation. |

## Open tasks for the next agent

1. If user wants the provider fixed locally, update their real config entry from `https://api.interknock.ai` to `https://api.inferknock.ai` and change type from `anthropic` to `openai-compatible`.
2. Ask InferKnock/provider admin to grant the token access to `GLM-5.2` or assign a distributor/channel for lowercase `glm-5.2`.
3. Retry `glm-5.2-fast` later or with provider support, because the upstream reached InferKnock but failed internally with `do_request_failed`.

## Key decisions

| Decision | Rationale |
| --- | --- |
| Used temporary `COPILOT_API_HOME` for corrected config tests | Avoided modifying the user's real provider config while testing likely fixes. |
| Tested OpenAI-compatible route | InferKnock `/v1/models` says both GLM models support `openai`, not Anthropic Messages. |
| Tested both uppercase and lowercase model ids | User originally asked for `GLM-5.2`; provider model list returns lowercase `glm-5.2`. |

## Blockers

- Current real config has a typoed/unresolvable base URL.
- Current token is not authorized for uppercase `GLM-5.2`.
- Lowercase `glm-5.2` currently has no available distributor/channel in InferKnock's `default` group.
- `glm-5.2-fast` currently fails upstream with `do_request_failed`.

## Suggested next step

Fix the InferKnock config host/type, then verify token/model access with the provider before expecting successful completions.
