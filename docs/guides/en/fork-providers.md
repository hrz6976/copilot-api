# Fork providers

CloudGPT setup is API-keyless:

1. Run `az login --tenant 72f988bf-86f1-41af-91ab-2d7cd011db47`.
2. Run `copilot-api auth login --provider cloudgpt` and keep the default base URL unless your CloudGPT endpoint differs.
3. Start the proxy with `copilot-api start`. The proxy calls Azure CLI for CloudGPT access tokens, caches them in memory, and refreshes them before expiry.

CloudGPT model discovery uses a built-in static catalog and built-in USD pricing defaults, so `/v1/models` does not depend on an upstream CloudGPT model-list endpoint.

The September 2026 catalog includes `gpt-6.1-sol-20260929`, `gpt-6-sol-20260922`, `gpt-6-luna-20260922`, and `DeepSeek-V4.1-Flash`. Use the `cloudgpt/` prefix when calling the gateway's shared routes. The three new GPT deployments default to Responses because CloudGPT rejects function tools combined with reasoning on their Chat Completions endpoint. Explicit per-model protocol overrides still apply. DeepSeek V4.1 Flash uses Chat Completions and supports streamed tool calls.

Live checks on October 2, 2026 passed for all four additions, including streamed tool calls. GPT Image 2.5 Flare and Sunburst generated images using Azure deployment URLs. DeepSeek V4 Pro 0813, Kimi K3, and the three MAI image deployments announced in September returned HTTP 404. Their catalog entries remain available because deployment availability can change independently of this package. The image checks used CloudGPT directly; the gateway's catalog listing does not add image-generation routes.

Microsoft LLM API setup is also API-keyless:

1. On Windows or macOS, run `copilot-api auth login --provider llmapi`, select an entitled work account in the native broker, and keep the default `https://fe-26.qas.bing.net/sdf` base URL. Other operating systems reject this provider with an actionable message.
2. Setup verifies that the selected account can acquire a token silently before writing the provider configuration or reporting success. Start the proxy after that check passes; it discovers the broker account and refreshes the device-bound LLM API token silently.
3. Use an exact catalog ID such as `llmapi/dev-anthropic-claude-sonnet-4-5`, or configure a friendly alias without changing the upstream ID:

   ```json
   {
     "modelMappings": {
       "claude-sonnet-4-5": "llmapi/dev-anthropic-claude-sonnet-4-5"
     }
   }
   ```

The LLM API catalog contains 38 text-generation candidates and routes Anthropic, Chat Completions, and Responses models by metadata. Catalog presence does not grant entitlement or guarantee that every upstream route is currently deployed for your tenant. Every catalog entry includes an estimated USD price per 1M tokens, with cache and long-context tiers where available. These estimates come from the closest public model in [BaseLLM model metadata](https://basellm.github.io/), are not official Microsoft LLM API billing rates, and may differ from internal costs. Model discovery exposes `pricing_estimated`, `pricing_source_model`, and `pricing_source_url`; use per-model `pricing` overrides for your actual rates. When installing from source with Bun, `@azure/msal-node-runtime` must remain in `trustedDependencies` so its native broker binary is installed.

Both providers omit `apiKey`: CloudGPT uses `authType: "azure-cli"`, while LLM API uses `authType: "llmapi-broker"`. LLM API also sets `transport: "llmapi"`, which selects taxonomy headers, exact `X-ModelType` routing, request bodies without a model field, and upstream paths without `/v1`. Configured per-model pricing fields override LLM API catalog estimates. CloudGPT and LLM API default to USD pricing.
