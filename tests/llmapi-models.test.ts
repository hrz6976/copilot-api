import { describe, expect, test } from "bun:test"

import {
  getEffectiveProviderModelConfig,
  resolveEffectiveProviderConfig,
  type ResolvedProviderConfig,
} from "../src/lib/config"
import { getLlmApiModel, getModels } from "../src/services/llmapi/get-models"

const llmApiConfig: ResolvedProviderConfig = {
  apiKey: "token",
  authType: "llmapi-broker",
  baseUrl: "https://fe-26.qas.bing.net/sdf",
  configuredAuthType: "llmapi-broker",
  name: "llmapi",
  transport: "llmapi",
  type: "openai-compatible",
}

describe("LLM API model catalog", () => {
  test("contains the exact 38 upstream text model IDs", () => {
    const models = getModels().data
    const ids = models.map((model) => model.id)

    expect(models).toHaveLength(38)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith("dev-"))).toBe(true)
    expect(ids).toContain("dev-anthropic-claude-sonnet-4-5")
    expect(ids).toContain("dev-anthropic-claude-opus-5")
    expect(ids).toContain("dev-gpt-56-reasoning-sol-oai-standard")
    expect(ids).toContain("dev-mai-code-1-flash")
    expect(ids.some((id) => id.includes("image"))).toBe(false)
    expect(ids.some((id) => id.includes("realtime"))).toBe(false)
  })

  test("records native endpoint and payload compatibility metadata", () => {
    expect(getLlmApiModel("dev-anthropic-claude-sonnet-4-5")).toMatchObject({
      provider_type: "anthropic",
      supported_endpoints: ["/v1/messages"],
    })
    expect(
      getLlmApiModel("dev-gpt-56-reasoning-sol-oai-standard"),
    ).toMatchObject({
      provider_type: "openai-responses",
      supported_endpoints: ["/v1/responses"],
    })
    expect(getLlmApiModel("dev-mai-code-1-flash")).toMatchObject({
      compatibility: {
        maxTokensParam: "max_completion_tokens",
        unsupportedParams: ["stop", "stream_options"],
      },
      provider_type: "openai-compatible",
      supported_endpoints: ["/v1/chat/completions"],
    })
  })

  test("provides sourced USD pricing estimates for every model", () => {
    const models = getModels().data

    expect(
      models.every(
        (model) =>
          model.pricing
          && model.pricing_currency === "USD"
          && model.pricing_estimated === true
          && model.pricing_source === "BaseLLM model metadata"
          && model.pricing_source_model
          && model.pricing_source_url?.startsWith(
            "https://raw.githubusercontent.com/basellm/llm-metadata/",
          ),
      ),
    ).toBe(true)
    expect(getLlmApiModel("dev-anthropic-claude-sonnet-4-5")).toMatchObject({
      pricing: {
        cachedInput: 0.3,
        cacheCreationInput: 3.75,
        input: 3,
        output: 15,
      },
      pricing_source_model: "claude-sonnet-4-5",
    })
    expect(getLlmApiModel("dev-mai-code-1-flash")).toMatchObject({
      pricing: { cachedInput: 0.075, input: 0.75, output: 4.5 },
      pricing_source_model: "mai-code-1-flash-picker",
    })
    expect(
      getLlmApiModel("dev-gpt-56-reasoning-sol-oai-standard")?.pricing?.tiers,
    ).toEqual([
      {
        cachedInput: 0.5,
        input: 5,
        maxInputTokens: 272_000,
        output: 30,
      },
      { cachedInput: 1, input: 10, output: 45 },
    ])
    expect(getLlmApiModel("dev-xai-grok-4.5")?.pricing?.tiers).toEqual([
      {
        cachedInput: 0.3,
        input: 2,
        maxInputTokens: 200_000,
        output: 6,
      },
      { cachedInput: 1, input: 4, output: 12 },
    ])
    expect(getLlmApiModel("dev-qwen-3-06b")).toMatchObject({
      pricing: { input: 0.04, output: 0.16 },
      pricing_source_model: "qwen3-0.6b",
    })
  })

  test("applies configured pricing over catalog estimates", () => {
    const models = getModels({
      models: {
        "dev-mai-code-1-flash": {
          pricing: { input: 1.25, output: 5 },
        },
      },
      pricingCurrency: "USD",
    }).data
    const maiCode = models.find((model) => model.id === "dev-mai-code-1-flash")
    const qwen = models.find((model) => model.id === "dev-qwen-3-32b")

    expect(maiCode).toMatchObject({
      pricing: { cachedInput: 0.075, input: 1.25, output: 5 },
      pricing_currency: "USD",
    })
    expect(qwen).toMatchObject({
      pricing: { input: 0.7, output: 2.8 },
      pricing_currency: "USD",
    })

    const effectiveConfig = getEffectiveProviderModelConfig(
      {
        ...llmApiConfig,
        models: {
          "dev-anthropic-claude-sonnet-4-5": {
            pricing: { input: 4 },
          },
        },
      },
      "dev-anthropic-claude-sonnet-4-5",
    )
    expect(effectiveConfig?.pricing).toMatchObject({
      cachedInput: 0.3,
      cacheCreationInput: 3.75,
      input: 4,
      output: 15,
    })
  })

  test("routes each exact model through its semantic protocol", () => {
    expect(
      resolveEffectiveProviderConfig(
        llmApiConfig,
        "dev-anthropic-claude-sonnet-4-5",
      ).type,
    ).toBe("anthropic")
    expect(
      resolveEffectiveProviderConfig(
        llmApiConfig,
        "dev-gpt-56-reasoning-sol-oai-standard",
      ).type,
    ).toBe("openai-responses")
    expect(
      resolveEffectiveProviderConfig(llmApiConfig, "dev-mai-code-1-flash").type,
    ).toBe("openai-compatible")
  })
})
