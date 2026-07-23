# Handoff Note — 231715 · gpt · tested-device-auth

## Inherited context

Continued from `conversations/260723-llmapi-provider/231710-gpt-researched-auth.md`. Azure CLI token acquisition for the llmapi scope had already failed with `AADSTS65002`, so the next candidate was MSAL device-code authentication using llmapi's registered public client.

## Work done this session

- [x] Started an ephemeral MSAL device-code flow with client ID `68df66a4-cad9-4bfd-872b-c6ddde00d6b2`, tenant `72f988bf-86f1-41af-91ab-2d7cd011db47`, and scope `https://substrate.office.com/llmapi/LLMAPI.dev`.
- [x] Confirmed the Microsoft device endpoint issued a verification URL and user code.
- [x] Stopped the polling process after the user reported they could not use device-code authentication.
- [ ] Validate the reference interactive/broker flow and make one live llmapi request.

## Current state

No provider source code was changed and no token cache was written. The ephemeral process was terminated with `Ctrl-C` while waiting in `acquire_token_by_device_flow`; it never received an access token and never called the llmapi endpoint.

| File | Change |
| --- | --- |
| `conversations/260723-llmapi-provider/231715-gpt-tested-device-auth.md` | Recorded the unsuccessful device-code smoke test. |

## Open tasks for the next agent

1. Ask for or observe the exact device-login rejection only if the user wants that path diagnosed.
2. Otherwise test MSAL interactive/broker authentication with the reference client ID and scope in an environment where the browser/broker callback can complete.
3. Do not implement Azure CLI or device-code auth as the llmapi provider's primary flow based on current evidence.
4. After authentication succeeds, send one non-streaming request to `https://fe-26.qas.bing.net/sdf/chat/completions` with model `dev-gpt-4o-gg` and the reference taxonomy headers.

## Key decisions

| Decision | Rationale |
| --- | --- |
| Stop the device-code process | The user reported that device-code authentication is unavailable to them. |
| Do not claim endpoint validation | The flow never returned an access token, so no HTTP request reached llmapi. |
| Keep interactive/broker auth as the next candidate | It is the authentication method used by the supplied `llmapi_client.py` reference. |

## Blockers

- No supported non-interactive authentication method has succeeded: Azure CLI is not preauthorized and device-code login is unavailable to the user.
- A live smoke test now requires an environment where the reference interactive/broker login can complete.

## Suggested next step

Run the reference MSAL interactive/broker flow on the user's desktop session and, if it succeeds, reuse its serialized MSAL cache for the gateway.
