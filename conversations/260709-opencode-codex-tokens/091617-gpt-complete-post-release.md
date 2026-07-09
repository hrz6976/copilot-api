# Handoff Note — 091617 · gpt · complete-post-release

## Inherited context

- Continued `conversations/260709-opencode-codex-tokens/091557-gpt-fixed-gpt-tokens.md`.
- User asked to commit the GPT-only `max_completion_tokens` fix, tag a new post version, and push to GitHub.
- Before tagging/pushing, user added one more patch request: CloudGPT pricing for newly added `Kimi-K2.7-Code` was missing.

## Work done this session

- [x] Bumped package versions from `1.13.20-post.1` to `1.13.20-post.2`.
- [x] Committed GPT-only provider token parameter fix.
- [x] Added CloudGPT built-in pricing for `Kimi-K2.7-Code`: `cachedInput: 0.19`, `input: 0.95`, `output: 4`.
- [x] Added regression coverage for CloudGPT Kimi K2.7 Code built-in pricing.
- [x] Amended the unpushed release commit to include both the token-param fix and the pricing patch.
- [x] Tagged `v1.13.20-post.2`.
- [x] Pushed `dev` and `v1.13.20-post.2` to `origin`.

## Current state

`origin/dev` and `origin/v1.13.20-post.2` both point to commit `5e160b9` (`fix: use max_completion_tokens for GPT provider requests`). Working tree has only unrelated untracked files/folders left.

| File | Change |
| --- | --- |
| `package.json` | Version `1.13.20-post.2`. |
| `package-lock.json` | Version `1.13.20-post.2`. |
| `desktop/package.json` | Version `1.13.20-post.2`. |
| `src/lib/provider-payload.ts` | Shared GPT-only token-limit helper. |
| `src/routes/chat-completions/handler.ts` | Reuses shared GPT token helper. |
| `src/routes/provider/chat-completions/handler.ts` | Applies GPT token helper before OpenAI-compatible provider forwarding. |
| `src/routes/provider/messages/handler.ts` | Applies GPT token helper after Anthropic-to-OpenAI translation. |
| `src/routes/provider/responses/handler.ts` | Applies GPT token helper after Responses-to-Chat fallback translation. |
| `src/lib/token-usage/pricing.ts` | Adds CloudGPT pricing for `Kimi-K2.7-Code`. |
| `tests/provider-chat-completions-alias.test.ts` | GPT provider Chat Completions regression. |
| `tests/provider-openai-compatible.test.ts` | GPT provider Messages/OpenCode regression. |
| `tests/provider-responses-openai-compatible.test.ts` | GPT Responses fallback regression. |
| `tests/token-usage-pricing.test.ts` | CloudGPT Kimi K2.7 Code pricing regression. |

## Open tasks for the next agent

1. Check GitHub Actions/NPM publish if the user asks for release verification.
2. Leave unrelated untracked `cloudgpt_aoai.py`, `conversations/260709-repository-investigation/`, and handoff notes alone unless the user asks to clean or commit them.

## Key decisions

| Decision | Rationale |
| --- | --- |
| Amended the local release commit instead of creating a second commit | User interrupted before tag/push and asked for one more patch before release. |
| Kept release version at `1.13.20-post.2` | `post.1` was already tagged/published; `post.2` was free and now contains both fixes. |
| Used Kimi K2.7 Code pricing `0.19 / 0.95 / 4` | Matches Kimi/OpenCode-style pricing and fills the missing CloudGPT entry. |

## Blockers

- None.

## Suggested next step

Verify the GitHub Actions publish run for `v1.13.20-post.2` if release confirmation is needed.
