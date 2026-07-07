# Handoff Note — 071116 · gpt · researched-aad

## Inherited context

Read `conversations/260707-cloudgpt-provider/071115-gpt-continue-cloudgpt.md`. CloudGPT has been added as a quick provider, currently requiring a manually supplied AAD bearer token stored as provider `apiKey`. The next question was how to generate Azure AAD/Microsoft Entra tokens and how token lifetime/refresh work.

## Work done this session

- [x] Corrected handoff location to project root after the user clarified that notes should be under `/home/v-runzhihe/copilot-api/conversations`.
- [x] Removed the mistaken empty handoff directory under the skill installation path.
- [x] Created project-root thread `conversations/260707-cloudgpt-provider`.
- [x] Wrote initial implementation-state note: `conversations/260707-cloudgpt-provider/071115-gpt-continue-cloudgpt.md`.
- [x] Researched Microsoft/Azure docs for token generation, access token lifetime, refresh token lifetime, and Azure Identity token cache behavior.

## Current state

| File | Change |
| ---- | ------ |
| `conversations/260707-cloudgpt-provider/071115-gpt-continue-cloudgpt.md` | Initial handoff note for CloudGPT provider registration work. |
| `conversations/260707-cloudgpt-provider/071116-gpt-researched-aad.md` | Closing handoff note with AAD token research summary. |

Key research findings:

- CloudGPT scope from `cloudgpt_aoai.py`: `api://feb7b661-cac7-44a8-8dc1-163b63c23df2/.default`.
- CloudGPT tenant from `cloudgpt_aoai.py`: `72f988bf-86f1-41af-91ab-2d7cd011db47`.
- Azure CLI can acquire a v2.0 Entra token for that scope:
  `az account get-access-token --tenant 72f988bf-86f1-41af-91ab-2d7cd011db47 --scope api://feb7b661-cac7-44a8-8dc1-163b63c23df2/.default`.
- Microsoft Entra default access-token lifetime for registered APIs is variable: 60-90 minutes, 75 minutes average. Apps should rely on `expires_in` or `expires_on`, not hard-code the lifetime.
- Azure CLI docs say `az account get-access-token` returns a token valid for at least 5 minutes, with a maximum of 60 minutes from the CLI command perspective.
- Refresh tokens default to 90 days in most scenarios, but 24 hours for SPAs and email OTP flows.
- Refresh tokens replace themselves on each use; old refresh tokens are not automatically revoked by replacement, so clients should store the new token and securely delete the old one.
- Client credentials flow does not issue refresh tokens; the app obtains a new access token by repeating the client credentials request.
- Azure Identity/MSAL credentials manage token acquisition, caching, and renewal. `TokenCachePersistenceOptions` can persist cache data, encrypted by default where supported.

## Open tasks for the next agent

1. Decide whether to implement automated CloudGPT auth in this repo.
2. If yes, choose one implementation strategy:
   - Use Azure CLI as an external token source (`az account get-access-token`) when available.
   - Add an Azure Identity dependency for Node/TypeScript and model CloudGPT after `cloudgpt_aoai.py`.
   - Keep manual bearer token only, but document users must refresh/re-run auth before expiry.
3. If adding automated refresh, update provider config/auth types carefully so CloudGPT can resolve a fresh token at request time without storing expired access tokens as static `apiKey`.
4. Add tests around token-expiry handling and provider resolution before changing runtime behavior.

## Key decisions

| Decision | Rationale |
| -------- | --------- |
| Prefer `expires_in`/`expires_on` over fixed lifetime assumptions | Microsoft docs show default variation and CLI-specific validity behavior. |
| Treat client credentials differently from delegated user flows | Microsoft docs state client credentials do not get refresh tokens; refresh is just reacquiring using app credentials. |
| Do not implement token automation during research-only request | User asked for web research, not code changes in this turn. |

## Blockers

- Need a product decision: should CloudGPT remain a quick provider with a pasted AAD token, or become a built-in AAD-auth provider with refresh/cache support?
- Need to know which auth modes are acceptable for this project: Azure CLI only, device code/broker, managed identity, client secret, or all modes from `cloudgpt_aoai.py`.

## Suggested next step

Ask the user whether they want automated CloudGPT token acquisition/refresh implemented, and if so which auth modes to support first.
