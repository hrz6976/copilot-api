# Handoff Note — 071118 · gpt · verified-token

## Inherited context

Read prior notes in `conversations/260707-cloudgpt-provider/`:

- `071115-gpt-continue-cloudgpt.md`: CloudGPT registered as a quick provider using base URL `https://cloudgpt-openai.azure-api.net/openai`, default type `openai-compatible`, and static bearer token in `apiKey`.
- `071116-gpt-researched-aad.md`: Azure AAD/Microsoft Entra token research. CloudGPT tenant/scope identified as tenant `72f988bf-86f1-41af-91ab-2d7cd011db47` and scope `api://feb7b661-cac7-44a8-8dc1-163b63c23df2/.default`.

## Work done this session

- [x] Used the local authenticated Azure CLI session to obtain a CloudGPT-scoped access token.
- [x] Did not print or store the access token in handoff or final output.
- [x] Validated the token against `https://cloudgpt-openai.azure-api.net/openai/ping`.

## Current state

Validation command shape:

```sh
az account get-access-token \
  --tenant 72f988bf-86f1-41af-91ab-2d7cd011db47 \
  --scope api://feb7b661-cac7-44a8-8dc1-163b63c23df2/.default \
  -o json
```

Observed non-secret metadata:

| Field | Value |
| ----- | ----- |
| `tokenType` | `Bearer` |
| `tenant` | `72f988bf-86f1-41af-91ab-2d7cd011db47` |
| `expiresOn` | `2026-07-07 12:29:07.000000` |
| `expires_on` | `1783398547` |
| Ping response body | `OK` |
| Ping HTTP status | `200` |

## Open tasks for the next agent

1. If implementing automation, add a CloudGPT token provider that can call Azure CLI and cache only metadata/token in memory as appropriate.
2. Decide whether to write acquired access tokens into `config.json`; avoid this if possible because they expire quickly.
3. Prefer resolving a fresh token at request time or before expiry in `resolveProviderConfig`.
4. Add tests that mock Azure CLI token output and verify `Authorization: Bearer <fresh-token>` is used without logging the token.

## Key decisions

| Decision | Rationale |
| -------- | --------- |
| Used `az account get-access-token --scope .../.default` | It matched Microsoft docs and the CloudGPT Python helper scope. |
| Validated with `/openai/ping` | `cloudgpt_aoai.py` uses that endpoint to check token access. |
| Did not print token | Access tokens are sensitive credentials. |

## Blockers

- None for validation. Implementation still needs a design decision: Azure CLI token source only vs broader Azure Identity/MSAL-style auth support.

## Suggested next step

Implement CloudGPT as a dynamic-token provider rather than asking users to paste short-lived access tokens into provider config.
