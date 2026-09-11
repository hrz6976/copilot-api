import { describe, expect, test } from "bun:test"

import {
  builtinProviderModelRegistry,
  BuiltinProviderModelRegistry,
} from "~/lib/builtin-provider-models"

describe("builtin provider model registry", () => {
  test("normalizes provider and model names when resolving model config", () => {
    expect(builtinProviderModelRegistry).toBeInstanceOf(
      BuiltinProviderModelRegistry,
    )
    expect(
      builtinProviderModelRegistry.getModelConfig(
        " DeepSeek ",
        " DEEPSEEK-V4-PRO ",
      ),
    ).toMatchObject({
      contextWindow: 1_000_000,
      inputModalities: ["text"],
      maxOutputTokens: 64_000,
      pricing: {
        cachedInput: 0.3,
        input: 9,
        output: 27,
      },
    })
  })

  test("lists model ids for a normalized provider name", () => {
    const modelIds = builtinProviderModelRegistry.getModelIds(" OPENCODE-GO ")
    for (const modelId of [
      "hy3",
      "gpt-5.6-luna",
      "qwen3.8-max",
      "minimax-m3",
      "glm-5.3-flash",
      "muse-spark-1.2-contributor",
      "hy4-preview",
      "qwen3.8-flash",
      "grok-4.6",
    ]) {
      expect(modelIds).toContain(modelId)
    }
  })

  test("does not keep Ox Alpha models in the catalog", () => {
    expect(
      builtinProviderModelRegistry.getModelConfig(
        "opencode-go",
        "ox-alpha-free",
      ),
    ).toBeUndefined()
  })

  test("defines the Muse Spark 1.2 Contributor model pricing", () => {
    expect(
      builtinProviderModelRegistry.getModelConfig(
        "opencode-go",
        "muse-spark-1.2-contributor",
      ),
    ).toEqual({
      contextWindow: 1_048_576,
      inputModalities: ["text", "image"],
      maxOutputTokens: 131_072,
      pricing: {
        cachedInput: 0.002,
        input: 0.1,
        output: 0.2,
      },
      reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"],
    })
  })

  test("defines the GLM-5.3 Flash model pricing", () => {
    expect(
      builtinProviderModelRegistry.getModelConfig(
        "opencode-go",
        "glm-5.3-flash",
      ),
    ).toEqual({
      contextWindow: 1_000_000,
      inputModalities: ["text", "image"],
      maxOutputTokens: 131_072,
      pricing: {
        cachedInput: 0.015,
        input: 0.075,
        output: 0.25,
      },
      reasoningEfforts: ["low", "high", "max"],
    })
  })

  test("defines the DeepSeek Flash model with peak-tier multimodal pricing", () => {
    expect(
      builtinProviderModelRegistry.getModelConfig("deepseek", "deepseek-flash"),
    ).toEqual({
      contextWindow: 1_000_000,
      inputModalities: ["text", "image"],
      maxOutputTokens: 384_000,
      pricing: {
        cachedInput: 0.04,
        input: 2,
        output: 8,
      },
    })
  })

  test("defines the supported Grok reasoning levels", () => {
    expect(
      builtinProviderModelRegistry.getModelConfig("opencode-go", "grok-4.5"),
    ).toMatchObject({
      defaultReasoningEffort: "high",
      reasoningEfforts: ["low", "medium", "high"],
    })
  })

  test("flags models that expect the OpenRouter-style reasoning field", () => {
    expect(
      builtinProviderModelRegistry.getModelConfig("opencode-go", "hy3"),
    ).toMatchObject({
      reasoningField: "reasoning",
    })
    expect(
      builtinProviderModelRegistry.getModelConfig("opencode-go", "hy4-preview"),
    ).toMatchObject({
      reasoningField: "reasoning",
    })
  })

  test("keeps GPT entries pricing-only", () => {
    expect(
      builtinProviderModelRegistry.getModelConfig("codex", "gpt-5.6-sol"),
    ).toEqual({
      pricing: {
        tiers: [
          {
            cacheCreationInput: 5,
            cachedInput: 0.4,
            input: 4,
            maxInputTokens: 272_000,
            output: 20,
          },
          {
            cacheCreationInput: 10,
            cachedInput: 0.8,
            input: 8,
            output: 30,
          },
        ],
      },
    })
  })

  test("prices GPT-6 Astra on CloudGPT with a long-context tier", () => {
    expect(
      builtinProviderModelRegistry.getModelConfig(
        "cloudgpt",
        "gpt-6-astra-20260903",
      ),
    ).toEqual({
      pricing: {
        tiers: [
          {
            cacheCreationInput: 12.5,
            cachedInput: 1,
            input: 10,
            maxInputTokens: 272_000,
            output: 50,
          },
          {
            cacheCreationInput: 25,
            cachedInput: 2,
            input: 20,
            output: 75,
          },
        ],
      },
    })
  })

  test("prices Grok 4.6 on CloudGPT with a doubled long-context band", () => {
    expect(
      builtinProviderModelRegistry.getModelConfig("cloudgpt", "grok-4.6"),
    ).toEqual({
      pricing: {
        tiers: [
          {
            cachedInput: 0.5,
            input: 2,
            maxInputTokens: 200_000,
            output: 6,
          },
          {
            cachedInput: 1,
            input: 4,
            output: 12,
          },
        ],
      },
    })
  })

  test("prices Kimi K3 on CloudGPT", () => {
    expect(
      builtinProviderModelRegistry.getModelConfig("cloudgpt", "Kimi-K3"),
    ).toEqual({
      pricing: {
        cachedInput: 0.3,
        input: 3,
        output: 15,
      },
    })
  })

  test("prices dated CloudGPT snapshots like their base models", () => {
    for (const [snapshot, base] of [
      ["DeepSeek-V4-Flash-0731", "DeepSeek-V4-Flash"],
      ["DeepSeek-V4-Pro-0813", "DeepSeek-V4-Pro"],
      ["gpt-chat-latest-20260528", "gpt-chat-latest-20260505"],
      ["gpt-chat-latest-20260624", "gpt-chat-latest-20260505"],
      ["gpt-chat-latest-20260806", "gpt-chat-latest-20260505"],
    ] as const) {
      expect(
        builtinProviderModelRegistry.getModelConfig("cloudgpt", snapshot),
      ).toEqual(builtinProviderModelRegistry.getModelConfig("cloudgpt", base))
    }
  })

  test("returns empty results for unknown providers and models", () => {
    expect(builtinProviderModelRegistry.getModelIds("unknown")).toEqual([])
    expect(
      builtinProviderModelRegistry.getModelConfig("deepseek", "unknown"),
    ).toBeUndefined()
  })
})
