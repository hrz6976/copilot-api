# Handoff Note — 231710 · gpt · researched-auth

## Inherited context

No earlier llmapi-provider handoff thread existed. The user supplied `llmapi_client.py` as the reference implementation and asked to add an `llmapi` provider, then paused implementation to validate authentication and live API access first.

## Work done this session

- [x] Read the full `llmapi_client.py` reference.
- [x] Read the relevant authentication section of `cloudgpt_aoai.py`.
- [x] Ran the reference client through an ephemeral `uv` environment with `requests` and `msal`; it reached `acquire_token_interactive` and waited for browser authentication, so no API request was sent.
- [x] Tested Azure CLI token acquisition for the llmapi scope without printing the token.
- [ ] Implement the llmapi provider after the authentication design is confirmed.

## Current state

No source files were changed. The only repository addition is this handoff thread/note. Existing unrelated untracked files were left untouched.

| File | Change |
| --- | --- |
| `conversations/260723-llmapi-provider/231710-gpt-researched-auth.md` | Recorded authentication test evidence and next steps. |

The Azure CLI test used tenant `72f988bf-86f1-41af-91ab-2d7cd011db47` and scope `https://substrate.office.com/llmapi/LLMAPI.dev`. It failed with `AADSTS65002`: Azure CLI's client application (`04b07795-8ddb-461a-bbee-02f9e1bf7b46`) is not preauthorized for the llmapi resource (`425e951a-14f3-4ad4-8daa-a80bfca62fcb`). No llmapi endpoint request was made.

## Open tasks for the next agent

1. Confirm with the user that llmapi authentication should use the reference public client ID `68df66a4-cad9-4bfd-872b-c6ddde00d6b2` through MSAL/broker or a terminal-friendly device-code flow.
2. Implement token caching and refresh for the llmapi-specific client/scope; do not reuse CloudGPT's Azure CLI token helper as-is.
3. Add llmapi request forwarding to `${baseUrl}/chat/completions`, setting `X-ModelType` and the four taxonomy headers from `llmapi_client.py`.
4. Add CLI configuration, model discovery/fallback behavior, focused tests, and documentation.
5. Run targeted tests, lint, typecheck, and builds.

## Key decisions

| Decision | Rationale |
| --- | --- |
| Do not reuse CloudGPT Azure CLI auth unchanged | Live token acquisition failed with `AADSTS65002` because the Azure CLI first-party client is not preauthorized for llmapi. |
| Preserve llmapi's registered public client identity | The reference explicitly uses client ID `68df66a4-cad9-4bfd-872b-c6ddde00d6b2`; this is materially different from Azure CLI's client identity. |
| Do not claim the API works yet | Authentication did not complete, so the request never reached `https://fe-26.qas.bing.net/sdf/chat/completions`. |

## Blockers

- A live endpoint test requires completing Microsoft authentication with the llmapi public client. The browser-based MSAL flow was silent in this terminal and was stopped without changing credentials.

## Suggested next step

Choose MSAL broker/interactive auth or device-code auth for client `68df66a4-cad9-4bfd-872b-c6ddde00d6b2`, then complete one authenticated `dev-gpt-4o-gg` chat-completions request before implementation.
