# Fork providers

CloudGPT setup is API-keyless:

1. Run `az login --tenant 72f988bf-86f1-41af-91ab-2d7cd011db47`.
2. Run `copilot-api auth login --provider cloudgpt` and keep the default base URL unless your CloudGPT endpoint differs.
3. Start the proxy with `copilot-api start`. The proxy calls Azure CLI for CloudGPT access tokens, caches them in memory, and refreshes them before expiry.

CloudGPT model discovery uses a built-in static catalog and built-in USD pricing defaults, so `/v1/models` does not depend on an upstream CloudGPT model-list endpoint.

The September 2026 catalog includes `gpt-6.1-sol-20260929`, `gpt-6-sol-20260922`, `gpt-6-luna-20260922`, and `DeepSeek-V4.1-Flash`. Use the `cloudgpt/` prefix when calling the gateway's shared routes. The three new GPT deployments default to Responses because CloudGPT rejects function tools combined with reasoning on their Chat Completions endpoint. Explicit per-model protocol overrides still apply. DeepSeek V4.1 Flash uses Chat Completions and supports streamed tool calls.

The October 2026 catalog adds `Microsoft-Decision-1` and its shared evaluation-only deployment `OCTO-PI`. These are text decision-scoring models, not chat models. CloudGPT exposes the [TypeSafe SystemOne contract](https://docs.typesafe.ai/api) at `https://cloudgpt-openai.azure-api.net/decision-api/v1/systemone`. Both deployments are listed by ordinary model discovery, with chat selection, streaming, and tool calling disabled; OCTO-PI is marked as preview. Token limits and pricing are unspecified.

Decision requests follow the same provider-routing and authentication conventions as completions. Send the gateway API key in `Authorization: Bearer <gateway-key>` or `x-api-key`; the server obtains the CloudGPT token through the existing provider configuration. The shared route applies `modelMappings` and removes the `cloudgpt/` model prefix before forwarding. The provider-scoped route accepts the deployment name directly:

| API | Shared route and model | Provider-scoped route and model |
| --- | --- | --- |
| Chat Completions | `/v1/chat/completions`, `cloudgpt/gpt-6.1-sol-20260929` | Use the shared route |
| Responses | `/v1/responses`, `cloudgpt/gpt-6.1-sol-20260929` | `/cloudgpt/v1/responses`, `gpt-6.1-sol-20260929` |
| Decision | `/v1/systemone`, `cloudgpt/Microsoft-Decision-1` | `/cloudgpt/v1/systemone`, `Microsoft-Decision-1` |

The gateway forwards `state`, `questions`, and additional JSON fields without translating them into a chat request. It preserves the upstream response body, status, and applicable headers, including error responses. Decision routes also support the existing forms without `/v1`. Use `OCTO-PI` in place of `Microsoft-Decision-1` to select the evaluation deployment. A TypeSafe SDK client can call the gateway directly:

```python
from typesafe_sdk import Choice, TypeSafeClient

with TypeSafeClient(
    api_key="YOUR_GATEWAY_API_KEY",
    base_url="http://127.0.0.1:4141/cloudgpt",
    model="Microsoft-Decision-1",
) as client:
    response = client.system_one(
        state="I was charged twice for my subscription.",
        questions={
            "department": Choice(
                instructions="Which support team should handle this?",
                criteria={"billing": None, "technical": None},
            )
        },
    )
    print(response.choices["department"].choice)
```

For the shared decision route, set `base_url="http://127.0.0.1:4141"` and `model="cloudgpt/Microsoft-Decision-1"`. Use the normal TypeSafe client for gateway calls; the internal helper below is configured to call CloudGPT directly.

The latest internal [CloudGPT helper](https://dev.azure.com/LLMCube/CloudGPT/_git/CloudGPT-AOAI?path=/cloudgpt_aoai.py) provides `get_type_safe_client(model=...)` and `async_get_type_safe_client(model=...)`. They reuse CloudGPT authentication with scope `api://feb7b661-cac7-44a8-8dc1-163b63c23df2/.default` and inject a fresh `Authorization: Bearer <token>` header through an HTTP request hook. The SDK's `api_key` parameter is a placeholder; a separate TypeSafe API key is unnecessary. Set its base URL to `https://cloudgpt-openai.azure-api.net/decision-api`. The helper skips `/openai/ping` validation because that route does not verify decision-model access. The public Foundry endpoint and Cognitive Services token scope describe a different deployment setup.

Live checks on October 19, 2026 used an Azure CLI token for the CloudGPT resource. The three GPT deployments returned HTTP 200 through Responses, and DeepSeek V4.1 Flash returned HTTP 200 through Chat Completions; all four answered `OK`. All four also passed streamed function-call assembly and a tool-result round trip through the gateway's shared `/v1/chat/completions` route. Both decision deployments returned HTTP 200 from `/decision-api/v1/systemone`, choosing `billing` for a duplicate-charge support request. Both reported the underlying model as `microsoft-decision-1`. Both also passed real HTTP calls through the gateway's shared and provider-scoped decision routes. The same gateway process and client API key passed Chat Completions and both shared and scoped Responses calls. The public Foundry path, including its `/openai`-prefixed variant, returned HTTP 404 on CloudGPT.

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
