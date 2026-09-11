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
      "gpt-5.6-sol-20260709",
      "gpt-5.6-terra-20260709",
      "gpt-5.6-luna-20260709",
      "gpt-5.3-codex-20260224",
      "o3-deep-research-20250626",
      "DeepSeek-V4-Pro",
      "Kimi-K2.6",
      "Kimi-K2.7-Code",
      "Llama-4-Maverick-17B-128E-Instruct-FP8",
      "MAI-Image-2.5",
      "MAI-Image-2.5-Flash",
      "sora-2-20251006",
      "gpt-6-astra-20260903",
      "gpt-chat-latest-20260528",
      "gpt-chat-latest-20260624",
      "gpt-chat-latest-20260806",
      "grok-4.6",
      "DeepSeek-V4-Flash-0731",
      "DeepSeek-V4-Pro-0813",
      "Kimi-K3",
      "gpt-image-2.5-flare",
      "gpt-image-2.5-sunburst",
      "MAI-Image-2.5-Pro",
      "MAI-Image-2.6",
      "MAI-Image-2.6-Flash",
    ]

    expect(CLOUDGPT_MODEL_CATALOG).toHaveLength(95)
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
    expect(byId.get("gpt-5.6-sol-20260709")).toMatchObject({
      capabilities: {
        limits: {
          max_context_window_tokens: 1_050_000,
          max_output_tokens: 128_000,
        },
        supports: {
          reasoning_effort: ["none", "low", "medium", "high", "xhigh", "max"],
          tool_calls: true,
          vision: true,
        },
        type: "chat",
      },
      name: "GPT-5.6 Sol",
      supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
      vendor: "openai",
    })
    expect(byId.get("gpt-5.6-terra-20260709")).toMatchObject({
      capabilities: {
        limits: {
          max_context_window_tokens: 1_050_000,
          max_output_tokens: 128_000,
        },
        supports: {
          tool_calls: true,
          vision: true,
        },
        type: "chat",
      },
      supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
    })
    expect(byId.get("gpt-5.6-luna-20260709")).toMatchObject({
      capabilities: {
        limits: {
          max_context_window_tokens: 1_050_000,
          max_output_tokens: 128_000,
        },
        supports: {
          tool_calls: true,
          vision: true,
        },
        type: "chat",
      },
      supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
    })
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
    expect(byId.get("Kimi-K2.7-Code")).toMatchObject({
      capabilities: {
        type: "chat",
      },
      model_picker_enabled: true,
      supported_endpoints: ["/v1/chat/completions"],
      vendor: "moonshot",
    })
    expect(byId.get("MAI-Image-2.5")).toMatchObject({
      capabilities: {
        type: "image",
      },
      model_picker_enabled: false,
      supported_endpoints: ["/v1/images/generations"],
      vendor: "microsoft",
    })
  })

  test("exposes GPT-6 Astra with its own reasoning effort range", () => {
    const byId = new Map(getModels().data.map((model) => [model.id, model]))

    expect(byId.get("gpt-6-astra-20260903")).toMatchObject({
      capabilities: {
        limits: {
          max_context_window_tokens: 1_050_000,
          max_output_tokens: 128_000,
        },
        supports: {
          reasoning_effort: ["low", "medium", "high", "xhigh", "max"],
          tool_calls: true,
          vision: true,
        },
        type: "chat",
      },
      name: "GPT-6 Astra",
      supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
      vendor: "openai",
    })
  })

  test("exposes the newer gpt-chat-latest snapshots", () => {
    const byId = new Map(getModels().data.map((model) => [model.id, model]))

    for (const [modelId, name] of [
      ["gpt-chat-latest-20260528", "GPT Chat Latest (2026-05-28)"],
      ["gpt-chat-latest-20260624", "GPT Chat Latest (2026-06-24)"],
      ["gpt-chat-latest-20260806", "GPT Chat Latest (2026-08-06)"],
    ] as const) {
      expect(byId.get(modelId)).toMatchObject({
        capabilities: {
          limits: {
            max_context_window_tokens: 128_000,
            max_output_tokens: 16_384,
          },
          supports: {
            reasoning_effort: ["medium"],
            tool_calls: true,
            vision: true,
          },
          type: "chat",
        },
        name,
        supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
        vendor: "openai",
      })
    }
  })

  test("exposes Grok 4.6 and Kimi K3 on chat completions only", () => {
    const byId = new Map(getModels().data.map((model) => [model.id, model]))

    expect(byId.get("grok-4.6")).toMatchObject({
      capabilities: {
        limits: {
          max_context_window_tokens: 500_000,
          max_output_tokens: 500_000,
        },
        supports: {
          reasoning_effort: ["low", "medium", "high", "xhigh"],
          tool_calls: true,
          vision: true,
        },
        type: "chat",
      },
      name: "Grok 4.6",
      supported_endpoints: ["/v1/chat/completions"],
      vendor: "xai",
    })
    expect(byId.get("Kimi-K3")).toMatchObject({
      capabilities: {
        limits: {
          max_context_window_tokens: 1_048_576,
          max_output_tokens: 131_072,
        },
        supports: {
          tool_calls: true,
          vision: true,
        },
        type: "chat",
      },
      name: "Kimi K3",
      supported_endpoints: ["/v1/chat/completions"],
      vendor: "moonshot",
    })
  })

  test("mirrors base model capabilities for dated DeepSeek V4 snapshots", () => {
    const byId = new Map(getModels().data.map((model) => [model.id, model]))

    for (const [snapshot, base] of [
      ["DeepSeek-V4-Flash-0731", "DeepSeek-V4-Flash"],
      ["DeepSeek-V4-Pro-0813", "DeepSeek-V4-Pro"],
    ] as const) {
      expect(byId.get(snapshot)?.capabilities).toEqual(
        byId.get(base)?.capabilities,
      )
      expect(byId.get(snapshot)?.supported_endpoints).toEqual([
        "/v1/chat/completions",
      ])
    }
  })

  test("exposes the new image generation models", () => {
    const byId = new Map(getModels().data.map((model) => [model.id, model]))

    for (const modelId of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
      expect(byId.get(modelId)).toMatchObject({
        capabilities: { type: "image" },
        model_picker_enabled: false,
        supported_endpoints: ["/v1/images/generations", "/v1/images/edits"],
        vendor: "openai",
      })
    }

    for (const modelId of [
      "MAI-Image-2.5-Pro",
      "MAI-Image-2.6",
      "MAI-Image-2.6-Flash",
    ]) {
      expect(byId.get(modelId)).toMatchObject({
        capabilities: { type: "image" },
        model_picker_enabled: false,
        supported_endpoints: ["/v1/images/generations"],
        vendor: "microsoft",
      })
    }
  })
})
