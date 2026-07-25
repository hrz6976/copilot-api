import { describe, expect, test } from "bun:test"

import { QUICK_PROVIDER_CONFIGS } from "../src/lib/quick-providers"

describe("quick provider configs", () => {
  test("uses Anthropic defaults for DeepSeek", () => {
    expect(QUICK_PROVIDER_CONFIGS.deepseek).toEqual({
      baseUrl: "https://api.deepseek.com/anthropic",
      editableType: true,
      pricingCurrency: "CNY",
      type: "anthropic",
    })
  })

  test("uses OpenAI-compatible defaults for OpenCode Go", () => {
    expect(QUICK_PROVIDER_CONFIGS["opencode-go"]).toEqual({
      baseUrl: "https://opencode.ai/zen/go",
      editableType: false,
      pricingCurrency: "USD",
      type: "openai-compatible",
    })
  })

  test("uses OpenAI-compatible defaults for CloudGPT", () => {
    expect(QUICK_PROVIDER_CONFIGS.cloudgpt).toEqual({
      authType: "azure-cli",
      baseUrl: "https://cloudgpt-openai.azure-api.net/openai",
      editableType: false,
      pricingCurrency: "USD",
      requiresApiKey: false,
      type: "openai-compatible",
    })
  })

  test("uses native broker and transport defaults for LLM API", () => {
    expect(QUICK_PROVIDER_CONFIGS.llmapi).toEqual({
      authType: "llmapi-broker",
      baseUrl: "https://fe-26.qas.bing.net/sdf",
      editableType: false,
      pricingCurrency: "USD",
      requiresApiKey: false,
      transport: "llmapi",
      type: "openai-compatible",
    })
  })
})
