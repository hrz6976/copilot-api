import { describe, expect, test } from "bun:test"

import {
  CLOUDGPT_MODEL_CATALOG,
  getModels,
} from "../src/services/cloudgpt/get-models"

describe("CloudGPT model catalog", () => {
  test("contains every active model from cloudgpt_aoai.py", () => {
    const modelIds = CLOUDGPT_MODEL_CATALOG.map((model) => model.id)
    const expectedModelIds = [
      "gpt-4.1-mini-20250414",
      "gpt-5.4-pro-20260305",
      "gpt-5.3-codex-20260224",
      "o3-deep-research-20250626",
      "DeepSeek-V4-Pro",
      "Kimi-K2.6",
      "Llama-4-Maverick-17B-128E-Instruct-FP8",
      "sora-2-20251006",
    ]

    expect(CLOUDGPT_MODEL_CATALOG).toHaveLength(76)
    expect(new Set(modelIds).size).toBe(modelIds.length)
    for (const modelId of expectedModelIds) {
      expect(modelIds).toContain(modelId)
    }
  })

  test("returns normalized model capabilities and supported endpoints", () => {
    const models = getModels()
    const byId = new Map(models.data.map((model) => [model.id, model]))

    expect(models.object).toBe("list")
    expect(models.data).toHaveLength(CLOUDGPT_MODEL_CATALOG.length)
    expect(byId.get("gpt-4.1-mini-20250414")).toMatchObject({
      capabilities: {
        limits: {
          max_context_window_tokens: 1_047_576,
          max_output_tokens: 32_768,
        },
        supports: {
          tool_calls: true,
          vision: true,
        },
        type: "chat",
      },
      model_picker_enabled: true,
      supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
      vendor: "openai",
    })
    expect(byId.get("gpt-5.4-pro-20260305")?.supported_endpoints).toEqual([
      "/v1/responses",
    ])
    expect(byId.get("text-embedding-3-large")).toMatchObject({
      capabilities: {
        type: "embeddings",
      },
      model_picker_enabled: false,
      supported_endpoints: ["/v1/embeddings"],
    })
    expect(byId.get("gpt-image-2")).toMatchObject({
      capabilities: {
        type: "image",
      },
      model_picker_enabled: false,
      supported_endpoints: ["/v1/images/generations", "/v1/images/edits"],
    })
  })
})
