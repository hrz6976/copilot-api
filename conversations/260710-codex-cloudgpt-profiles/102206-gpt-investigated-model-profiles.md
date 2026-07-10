# Handoff: Codex CloudGPT model profile investigation

## Task
Determine whether Codex reads model profiles for CloudGPT namespaced models such as `cloudgpt/gpt-5.6-sol-20260709` with the current `~/.codex/config.toml`, using the local `~/codex` source.

## Findings
- The active config selects `model = "gpt-5.6-sol"` and custom provider `copilot_api`, with explicit context overrides (`272000` context, `244800` auto-compact).
- Current Codex source and CLI `0.144.1` load the bundled model catalog, then use longest-prefix matching. For a one-segment namespace they strip the namespace and retry, so `cloudgpt/gpt-5.6-sol-20260709` matches bundled profile slug `gpt-5.6-sol`.
- Current bundled `gpt-5.6-sol` profile includes context `372000`, multi-agent `v2`, `tool_mode = code_mode_only`, Responses Lite, verbosity support, and other capabilities. The config context override lowers effective context to `272000`; auto-compact becomes `244800`.
- The currently running VS Code session reports `cli_version = 0.142.5`, not the shell CLI `0.144.1` or latest checkout.
- Codex `0.142.5` already has namespace-suffix matching, but its bundled catalog contains `gpt-5.5`, `gpt-5.4`, and `gpt-5.4-mini`, not `gpt-5.6-sol`. Therefore GPT-5.6 gets fallback metadata unless a remote catalog supplies a matching profile.
- With current auth, remote `/models` refresh does not occur: `~/.codex/auth.json` is API-key auth (`uses_codex_backend = false`), and provider refresh checks only Codex-backend auth or provider command auth (`model_providers.*.auth`). The inline config `api_key` does not satisfy `has_command_auth()`.
- Runtime evidence agrees: the active `0.142.5` GPT-5.6 session has `multi_agent_version = v1` supplied by current harness defaults, not the `v2` value in the newer GPT-5.6 model profile. Task context window is `258400`, which is 95% of the explicit `272000` config override.
- A prior `cloudgpt/gpt-5.5-20260424` session did receive the known GPT-5.5 metadata path because that prefix exists in the `0.142.5` bundled catalog.

## Verification
- Read source at `~/codex/codex-rs/models-manager/src/manager.rs`, `model_info.rs`, provider manager/auth code, and bundled `models.json`.
- Compared git tags `rust-v0.142.5` and `rust-v0.144.1`.
- Inspected current session JSONL and auth/config files with secrets redacted.
- Could not run Rust unit test because `cargo` is not installed in PATH; source includes explicit namespace matching tests.

## Recommended next steps
1. Update/restart the VS Code Codex extension so its embedded runtime is `0.144.1` or newer; then CloudGPT GPT-5.6 namespaced IDs should inherit the bundled `gpt-5.6-sol` profile.
2. Alternatively provide `model_catalog_json` in Codex config with the desired profile, or configure provider command auth so remote `/models` refresh is eligible and ensure the endpoint returns Codex `ModelInfo` schema rather than generic OpenAI `data` model objects.
3. If testing a namespaced ID directly, set `model = "cloudgpt/gpt-5.6-sol-20260709"`; the gateway may otherwise add/translate the namespace after Codex has already resolved metadata for the unnamespaced config model.
