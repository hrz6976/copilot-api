# Handoff Note — 071338 · gpt · reviewed-onboarding

## Inherited context

Continuing `conversations/260707-cloudgpt-provider/`. Prior notes document CloudGPT quick-provider registration, Azure AAD token research, Azure CLI dynamic token refresh, live CloudGPT smoke tests, and static CloudGPT model catalog/pricing work.

Locked-in decisions:

- CloudGPT raw config uses `authType: "azure-cli"` and no stored `apiKey`.
- Runtime resolution converts CloudGPT Azure CLI auth into bearer `authorization`.
- CloudGPT model discovery uses a built-in static catalog.
- Token values must not be printed.

## Work done this session

- [x] Reviewed the CloudGPT onboarding path across README, CLI auth setup, desktop UI, and runtime token errors.
- [x] Identified the main UX gap: README documented `az login --tenant ...`, but CLI setup did not show the exact Azure CLI command when a user chose CloudGPT; desktop text also lacked the exact tenant command.
- [x] Added a shared `CLOUDGPT_AZURE_LOGIN_COMMAND` constant in `src/lib/cloudgpt-token.ts`.
- [x] Updated CLI CloudGPT setup to print:
  - CloudGPT uses local Azure CLI instead of an API key.
  - `az login --tenant 72f988bf-86f1-41af-91ab-2d7cd011db47`.
  - The proxy refreshes CloudGPT AAD tokens automatically.
- [x] Updated desktop CloudGPT setup copy to include the exact `az login --tenant ...` command and clarify no API key is stored.
- [x] Renamed the desktop provider picker divider from `API Key` to `Providers` so CloudGPT is not visually classified as an API-key provider.
- [x] Added CloudGPT prerequisite and concise API-keyless setup steps to `README.md` and `README.zh-CN.md`.
- [x] Added a CLI test that asserts CloudGPT Azure CLI setup guidance is printed.

## Current state

CloudGPT onboarding now has four user-facing guidance points:

1. README prerequisites mention Azure CLI login for CloudGPT.
2. README Auth section has a three-step CloudGPT setup:
   - install Azure CLI and run `az login --tenant 72f988bf-86f1-41af-91ab-2d7cd011db47`
   - run `copilot-api auth login --provider cloudgpt`
   - run `copilot-api start`
3. CLI `auth login --provider cloudgpt` prints the Azure CLI requirement before prompts.
4. Desktop CloudGPT setup shows the exact Azure CLI command instead of an API-key field.

| File | Change |
| ---- | ------ |
| `src/lib/cloudgpt-token.ts` | Added `CLOUDGPT_AZURE_LOGIN_COMMAND`. |
| `src/auth.ts` | Added CloudGPT-specific CLI onboarding info messages. |
| `desktop/src/pages/AuthPage.tsx` | Changed provider picker divider from `API Key` to `Providers`; CloudGPT still hides API key input. |
| `desktop/src/locales/en.ts` | CloudGPT Azure CLI setup message now includes exact tenant command and no-API-key note. |
| `desktop/src/locales/zh.ts` | Chinese CloudGPT Azure CLI setup message now includes exact tenant command and no-API-key note. |
| `README.md` | Added CloudGPT Azure CLI prerequisite and three-step setup snippet. |
| `README.zh-CN.md` | Added Chinese CloudGPT Azure CLI prerequisite and three-step setup snippet. |
| `tests/auth-login.test.ts` | Added regression test for CLI CloudGPT setup guidance. |

Validation evidence:

- `bun test tests/auth-login.test.ts tests/cloudgpt-token.test.ts desktop/tests/desktop-provider-auth.test.ts` — passed: 40 pass, 0 fail.
- `bun run typecheck --pretty false` — passed.
- `bun run lint` — passed.
- `bun test` — passed: 403 pass, 0 fail, 1097 expectations across 48 files.
- `bun run build` — passed with existing tsdown `define` warning.
- `bun run build:desktop` — passed with existing tsdown `define` warning.
- `git --no-pager diff --check` — passed.

## Open tasks for the next agent

1. If commit is requested, review the full diff. The worktree includes multiple prior uncommitted CloudGPT changes beyond this onboarding patch.
2. Decide whether to commit `cloudgpt_aoai.py` and `conversations/`; both are still untracked.
3. Optional future UX improvement: if desktop localization is broadened, replace the hard-coded `Providers` and `OAuth` section labels with localized strings.

## Key decisions

| Decision | Rationale |
| -------- | --------- |
| Show exact `az login --tenant ...` during CLI setup | Users should not need to search README after selecting CloudGPT interactively. |
| Keep setup API-keyless | CloudGPT uses Azure CLI dynamic auth; prompting for an API key would imply storing short-lived AAD tokens. |
| Do not validate Azure CLI during configuration | Saving config remains possible before login; runtime token acquisition already surfaces a clear error, and CLI setup now tells users how to log in. |
| Rename desktop `API Key` section to `Providers` | CloudGPT is a provider option but not an API-key provider, so the old section label was misleading. |

## Blockers

- None.

## Suggested next step

Review the combined CloudGPT diff for commit readiness, then commit if the user wants these changes persisted.
