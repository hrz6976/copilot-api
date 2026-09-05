import type { TokenUsagePricingConfig } from "./token-usage/pricing"
import type { CodexReasoningEffort, ModelReasoningField } from "./config-store"

export type BuiltinProviderInputModality = "text" | "image"

export interface BuiltinProviderModelConfig {
  contextWindow?: number
  defaultReasoningEffort?: CodexReasoningEffort
  inputModalities?: Array<BuiltinProviderInputModality>
  maxOutputTokens?: number
  pricing: TokenUsagePricingConfig
  reasoningEfforts?: Array<CodexReasoningEffort>
  // Message field carrying assistant thinking text in upstream requests,
  // for models that do not follow the default "reasoning_content"
  // convention (e.g. opencode-go hy3/hy4 use the OpenRouter-style
  // "reasoning" field)
  reasoningField?: ModelReasoningField
}

type BuiltinProviderModelCatalog = Record<
  string,
  Record<string, BuiltinProviderModelConfig>
>

const CLOUDGPT_GPT5_PRICING: TokenUsagePricingConfig = {
  cachedInput: 0.125,
  input: 1.25,
  output: 10,
}
const CLOUDGPT_GPT5_MINI_PRICING: TokenUsagePricingConfig = {
  cachedInput: 0.025,
  input: 0.25,
  output: 2,
}
const CLOUDGPT_GPT5_NANO_PRICING: TokenUsagePricingConfig = {
  cachedInput: 0.005,
  input: 0.05,
  output: 0.4,
}
const CLOUDGPT_GPT52_PRICING: TokenUsagePricingConfig = {
  cachedInput: 0.175,
  input: 1.75,
  output: 14,
}
const CLOUDGPT_GPT54_PRICING: TokenUsagePricingConfig = {
  tiers: [
    {
      cachedInput: 0.25,
      input: 2.5,
      maxInputTokens: 272_000,
      output: 15,
    },
    {
      cachedInput: 0.5,
      input: 5,
      output: 22.5,
    },
  ],
}
const CLOUDGPT_GPT54_PRO_PRICING: TokenUsagePricingConfig = {
  tiers: [
    {
      input: 30,
      maxInputTokens: 272_000,
      output: 180,
    },
    {
      input: 60,
      output: 270,
    },
  ],
}
const CLOUDGPT_GPT55_PRICING: TokenUsagePricingConfig = {
  tiers: [
    {
      cachedInput: 0.5,
      input: 5,
      maxInputTokens: 272_000,
      output: 30,
    },
    {
      cachedInput: 1,
      input: 10,
      output: 45,
    },
  ],
}
const CLOUDGPT_GPT56_SOL_PRICING: TokenUsagePricingConfig = {
  cachedInput: 0.5,
  input: 5,
  output: 30,
}
const CLOUDGPT_GPT56_TERRA_PRICING: TokenUsagePricingConfig = {
  cachedInput: 0.25,
  input: 2.5,
  output: 15,
}
const CLOUDGPT_GPT56_LUNA_PRICING: TokenUsagePricingConfig = {
  cachedInput: 0.1,
  input: 1,
  output: 6,
}
const CLOUDGPT_GROK_FAST_PRICING: TokenUsagePricingConfig = {
  cachedInput: 0.05,
  input: 0.2,
  output: 0.5,
}

export class BuiltinProviderModelRegistry {
  private static readonly catalog: BuiltinProviderModelCatalog = {
    cloudgpt: {
      "codex-mini-20250516": {
        pricing: {
          cachedInput: 0.375,
          input: 1.5,
          output: 6,
        },
      },
      "deepseek-r1": {
        pricing: {
          input: 1.35,
          output: 5.4,
        },
      },
      "deepseek-r1-0528": {
        pricing: {
          input: 1.35,
          output: 5.4,
        },
      },
      "deepseek-v3-0324": {
        pricing: {
          input: 1.14,
          output: 4.56,
        },
      },
      "deepseek-v3.1": {
        pricing: {
          input: 0.56,
          output: 1.68,
        },
      },
      "deepseek-v3.2": {
        pricing: {
          input: 0.58,
          output: 1.68,
        },
      },
      "deepseek-v3.2-speciale": {
        pricing: {
          input: 0.58,
          output: 1.68,
        },
      },
      "deepseek-v4-flash": {
        pricing: {
          input: 0.19,
          output: 0.51,
        },
      },
      "deepseek-v4-pro": {
        pricing: {
          input: 1.74,
          output: 3.48,
        },
      },
      "gpt-4.1-20250414": {
        pricing: {
          cachedInput: 0.5,
          input: 2,
          output: 8,
        },
      },
      "gpt-4.1-mini-20250414": {
        pricing: {
          cachedInput: 0.1,
          input: 0.4,
          output: 1.6,
        },
      },
      "gpt-4.1-nano-20250414": {
        pricing: {
          cachedInput: 0.025,
          input: 0.1,
          output: 0.4,
        },
      },
      "gpt-4o-20240513": {
        pricing: {
          input: 5,
          output: 15,
        },
      },
      "gpt-4o-20240806": {
        pricing: {
          cachedInput: 1.25,
          input: 2.5,
          output: 10,
        },
      },
      "gpt-4o-20241120": {
        pricing: {
          cachedInput: 1.25,
          input: 2.5,
          output: 10,
        },
      },
      "gpt-4o-mini-20240718": {
        pricing: {
          cachedInput: 0.075,
          input: 0.15,
          output: 0.6,
        },
      },
      "gpt-5-20250807": { pricing: CLOUDGPT_GPT5_PRICING },
      "gpt-5-chat-20250807": { pricing: CLOUDGPT_GPT5_PRICING },
      "gpt-5-chat-20251003": { pricing: CLOUDGPT_GPT5_PRICING },
      "gpt-5-codex-20250915": { pricing: CLOUDGPT_GPT5_PRICING },
      "gpt-5-mini-20250807": { pricing: CLOUDGPT_GPT5_MINI_PRICING },
      "gpt-5-nano-20250807": { pricing: CLOUDGPT_GPT5_NANO_PRICING },
      "gpt-5-pro-20251006": {
        pricing: {
          input: 15,
          output: 120,
        },
      },
      "gpt-5.1-20251113": { pricing: CLOUDGPT_GPT5_PRICING },
      "gpt-5.1-chat-20251113": { pricing: CLOUDGPT_GPT5_PRICING },
      "gpt-5.1-codex-20251113": { pricing: CLOUDGPT_GPT5_PRICING },
      "gpt-5.1-codex-max-20251204": { pricing: CLOUDGPT_GPT5_PRICING },
      "gpt-5.1-codex-mini-20251113": { pricing: CLOUDGPT_GPT5_MINI_PRICING },
      "gpt-5.2-20251211": { pricing: CLOUDGPT_GPT52_PRICING },
      "gpt-5.2-chat-20251211": { pricing: CLOUDGPT_GPT52_PRICING },
      "gpt-5.2-chat-20260210": { pricing: CLOUDGPT_GPT52_PRICING },
      "gpt-5.2-codex-20260114": { pricing: CLOUDGPT_GPT52_PRICING },
      "gpt-5.3-chat-20260303": { pricing: CLOUDGPT_GPT52_PRICING },
      "gpt-5.3-codex-20260224": { pricing: CLOUDGPT_GPT52_PRICING },
      "gpt-5.4-20260305": { pricing: CLOUDGPT_GPT54_PRICING },
      "gpt-5.4-mini-20260317": {
        pricing: {
          cachedInput: 0.075,
          input: 0.75,
          output: 4.5,
        },
      },
      "gpt-5.4-nano-20260317": {
        pricing: {
          cachedInput: 0.02,
          input: 0.2,
          output: 1.25,
        },
      },
      "gpt-5.4-pro-20260305": { pricing: CLOUDGPT_GPT54_PRO_PRICING },
      "gpt-5.5-20260424": { pricing: CLOUDGPT_GPT55_PRICING },
      "gpt-5.6-luna-20260709": { pricing: CLOUDGPT_GPT56_LUNA_PRICING },
      "gpt-5.6-sol-20260709": { pricing: CLOUDGPT_GPT56_SOL_PRICING },
      "gpt-5.6-terra-20260709": { pricing: CLOUDGPT_GPT56_TERRA_PRICING },
      "gpt-chat-latest-20260505": { pricing: CLOUDGPT_GPT52_PRICING },
      "grok-3": {
        pricing: {
          cachedInput: 0.75,
          input: 3,
          output: 15,
        },
      },
      "grok-3-mini": {
        pricing: {
          cachedInput: 0.075,
          input: 0.3,
          output: 0.5,
        },
      },
      "grok-4": {
        pricing: {
          cachedInput: 0.75,
          input: 3,
          output: 15,
        },
      },
      "grok-4-1-fast-non-reasoning": { pricing: CLOUDGPT_GROK_FAST_PRICING },
      "grok-4-1-fast-reasoning": { pricing: CLOUDGPT_GROK_FAST_PRICING },
      "grok-4-20-non-reasoning": {
        pricing: {
          input: 2,
          output: 6,
        },
      },
      "grok-4-20-reasoning": {
        pricing: {
          input: 2,
          output: 6,
        },
      },
      "grok-4-fast-non-reasoning": { pricing: CLOUDGPT_GROK_FAST_PRICING },
      "grok-4-fast-reasoning": { pricing: CLOUDGPT_GROK_FAST_PRICING },
      "grok-4.3": {
        pricing: {
          cachedInput: 0.2,
          tiers: [
            {
              cachedInput: 0.2,
              input: 1.25,
              maxInputTokens: 200_000,
              output: 2.5,
            },
            {
              cachedInput: 0.4,
              input: 2.5,
              output: 5,
            },
          ],
        },
      },
      "grok-code-fast-1": {
        pricing: {
          cachedInput: 0.02,
          input: 0.2,
          output: 1.5,
        },
      },
      "kimi-k2-thinking": {
        pricing: {
          cachedInput: 0.15,
          input: 0.6,
          output: 2.5,
        },
      },
      "kimi-k2.5": {
        pricing: {
          cachedInput: 0.1,
          input: 0.6,
          output: 3,
        },
      },
      "kimi-k2.6": {
        pricing: {
          cachedInput: 0.16,
          input: 0.95,
          output: 4,
        },
      },
      "kimi-k2.7-code": {
        pricing: {
          cachedInput: 0.19,
          input: 0.95,
          output: 4,
        },
      },
      "llama-3.3-70b-instruct": {
        pricing: {
          input: 0.71,
          output: 0.71,
        },
      },
      "llama-4-maverick-17b-128e-instruct-fp8": {
        pricing: {
          input: 0.25,
          output: 1,
        },
      },
      "o1-20241217": {
        pricing: {
          cachedInput: 7.5,
          input: 15,
          output: 60,
        },
      },
      "o3-20250416": {
        pricing: {
          cachedInput: 0.5,
          input: 2,
          output: 8,
        },
      },
      "o3-deep-research-20250626": {
        pricing: {
          cachedInput: 2.5,
          input: 10,
          output: 40,
        },
      },
      "o3-mini-20250131": {
        pricing: {
          cachedInput: 0.55,
          input: 1.1,
          output: 4.4,
        },
      },
      "o3-pro-20250610": {
        pricing: {
          input: 20,
          output: 80,
        },
      },
      "o4-mini-20250416": {
        pricing: {
          cachedInput: 0.275,
          input: 1.1,
          output: 4.4,
        },
      },
    },
    codex: {
      "gpt-5.3-codex": {
        pricing: {
          cachedInput: 0.175,
          input: 1.75,
          output: 14,
        },
      },
      "gpt-5.4": {
        pricing: {
          tiers: [
            {
              cachedInput: 0.25,
              input: 2.5,
              maxInputTokens: 272_000,
              output: 15,
            },
            {
              cachedInput: 0.5,
              input: 5,
              output: 22.5,
            },
          ],
        },
      },
      "gpt-5.4-mini": {
        pricing: {
          tiers: [
            {
              cachedInput: 0.075,
              input: 0.75,
              maxInputTokens: 272_000,
              output: 4.5,
            },
            {
              cachedInput: 0.15,
              input: 1.5,
              output: 6.75,
            },
          ],
        },
      },
      "gpt-5.5": {
        pricing: {
          tiers: [
            {
              cachedInput: 0.5,
              input: 5,
              maxInputTokens: 272_000,
              output: 30,
            },
            {
              cachedInput: 1,
              input: 10,
              output: 45,
            },
          ],
        },
      },
      "gpt-5.6-sol": {
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
      },
      "gpt-5.6-terra": {
        pricing: {
          tiers: [
            {
              cacheCreationInput: 2.5,
              cachedInput: 0.2,
              input: 2,
              maxInputTokens: 272_000,
              output: 12,
            },
            {
              cacheCreationInput: 5,
              cachedInput: 0.4,
              input: 4,
              output: 18,
            },
          ],
        },
      },
      "gpt-5.6-luna": {
        pricing: {
          tiers: [
            {
              cacheCreationInput: 0.25,
              cachedInput: 0.02,
              input: 0.2,
              maxInputTokens: 272_000,
              output: 1.2,
            },
            {
              cacheCreationInput: 0.5,
              cachedInput: 0.04,
              input: 0.4,
              output: 1.8,
            },
          ],
        },
      },
      "gpt-6-astra": {
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
      },
    },
    dashscope: {
      "glm-5.1": {
        contextWindow: 202_752,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          tiers: [
            {
              cachedInput: 1.2,
              cacheCreationInput: 7.5,
              explicitCachedInput: 0.6,
              input: 6,
              maxInputTokens: 32_000,
              output: 24,
            },
            {
              cachedInput: 1.6,
              cacheCreationInput: 10,
              explicitCachedInput: 0.8,
              input: 8,
              maxInputTokens: 200_000,
              output: 28,
            },
          ],
        },
      },
      "glm-5.2": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 2,
          cacheCreationInput: 10,
          explicitCachedInput: 0.8,
          input: 8,
          output: 28,
        },
      },
      "qwen3.7-max": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 2.4,
          cacheCreationInput: 15,
          explicitCachedInput: 1.2,
          input: 12,
          output: 36,
        },
      },
      "qwen3.8-max": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 1.5,
          cacheCreationInput: 15,
          explicitCachedInput: 1,
          input: 12,
          output: 36,
        },
      },
      "deepseek-v4-flash-0731": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.2,
          input: 1,
          output: 2,
        },
      },
      "qwen3.7-plus": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          tiers: [
            {
              cachedInput: 0.4,
              cacheCreationInput: 2.5,
              explicitCachedInput: 0.2,
              input: 2,
              maxInputTokens: 256_000,
              output: 8,
            },
            {
              cachedInput: 1.2,
              cacheCreationInput: 7.5,
              explicitCachedInput: 0.6,
              input: 6,
              maxInputTokens: 1_000_000,
              output: 24,
            },
          ],
        },
      },
      "kimi/kimi-k3": {
        contextWindow: 1_048_576,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 2,
          input: 20,
          output: 100,
        },
      },
    },
    deepseek: {
      "deepseek-v4-flash": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.1,
          input: 3,
          output: 9,
        },
      },
      "deepseek-v4-flash-vision-exp": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.1,
          input: 3,
          output: 9,
        },
      },
      "deepseek-v4-pro": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.3,
          input: 9,
          output: 27,
        },
      },
    },
    "opencode-go": {
      hy3: {
        contextWindow: 256_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.035,
          input: 0.14,
          output: 0.58,
        },
        reasoningField: "reasoning",
      },
      "hy4-preview": {
        contextWindow: 1_024_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.042,
          input: 0.834,
          output: 2.501,
        },
        reasoningEfforts: ["high"],
        reasoningField: "reasoning",
      },
      "gpt-5.6-luna": {
        pricing: {
          tiers: [
            {
              cacheCreationInput: 0.125,
              cachedInput: 0.01,
              input: 0.1,
              maxInputTokens: 272_000,
              output: 0.6,
            },
            {
              cacheCreationInput: 0.25,
              cachedInput: 0.02,
              input: 0.2,
              output: 0.9,
            },
          ],
        },
      },
      "glm-5.2": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.26,
          input: 1.4,
          output: 4.4,
        },
      },
      "glm-5.3": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.26,
          input: 1.4,
          output: 4.4,
        },
      },
      "glm-5.3-flash": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 131_072,
        pricing: {
          cachedInput: 0.015,
          input: 0.075,
          output: 0.25,
        },
        reasoningEfforts: ["low", "high", "max"],
      },
      "muse-spark-1.2-contributor": {
        contextWindow: 1_048_576,
        inputModalities: ["text", "image"],
        maxOutputTokens: 131_072,
        pricing: {
          cachedInput: 0.002,
          input: 0.1,
          output: 0.2,
        },
        reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"],
      },
      "muse-spark-1.3-contributor": {
        contextWindow: 1_048_576,
        inputModalities: ["text", "image"],
        maxOutputTokens: 131_072,
        pricing: {
          cachedInput: 0.002,
          input: 0.1,
          output: 0.2,
        },
        reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"],
      },
      "grok-4.5": {
        contextWindow: 500_000,
        defaultReasoningEffort: "high",
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
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
        reasoningEfforts: ["low", "medium", "high"],
      },
      "grok-4.6": {
        contextWindow: 500_000,
        defaultReasoningEffort: "high",
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
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
        reasoningEfforts: ["low", "medium", "high", "xhigh"],
      },
      "deepseek-v4-flash": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.007,
          input: 0.22,
          output: 0.66,
        },
      },
      "deepseek-v4-flash-vision-exp": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 384_000,
        pricing: {
          cachedInput: 0.007,
          input: 0.22,
          output: 0.66,
        },
        reasoningEfforts: ["low", "high", "max"],
      },
      "deepseek-v4-pro": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.022,
          input: 0.66,
          output: 1.98,
        },
      },
      "kimi-k2.7-code": {
        contextWindow: 262_144,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.19,
          input: 0.95,
          output: 4,
        },
      },
      "kimi-k3": {
        contextWindow: 1_048_576,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.3,
          input: 3,
          output: 15,
        },
      },
      "mimo-v2.5": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.0028,
          input: 0.14,
          output: 0.28,
        },
      },
      "mimo-v2.5-pro": {
        contextWindow: 1_048_576,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.0145,
          input: 1.74,
          output: 3.48,
        },
      },
      "qwen3.7-plus": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          tiers: [
            {
              cacheCreationInput: 0.5,
              cachedInput: 0.04,
              input: 0.4,
              maxInputTokens: 200_000,
              output: 1.6,
            },
            {
              cacheCreationInput: 1.5,
              cachedInput: 0.12,
              input: 1.2,
              maxInputTokens: 256_000,
              output: 4.8,
            },
          ],
        },
      },
      "qwen3.7-max": {
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cacheCreationInput: 3.125,
          cachedInput: 0.5,
          input: 2.5,
          output: 7.5,
        },
      },
      "qwen3.8-max": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cacheCreationInput: 2.5,
          cachedInput: 0.25,
          input: 2,
          output: 6,
        },
      },
      "qwen3.8-flash": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 131_072,
        pricing: {
          cacheCreationInput: 0.2,
          cachedInput: 0.016,
          input: 0.15,
          output: 0.47,
        },
        reasoningEfforts: ["low", "medium", "xhigh"],
      },
      "minimax-m2.7": {
        contextWindow: 204_800,
        inputModalities: ["text"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.06,
          input: 0.3,
          output: 1.2,
        },
      },
      "minimax-m3": {
        contextWindow: 1_000_000,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          tiers: [
            {
              cachedInput: 0.06,
              input: 0.3,
              maxInputTokens: 200_000,
              output: 1.2,
            },
            {
              cachedInput: 0.12,
              input: 0.6,
              maxInputTokens: 512_000,
              output: 2.4,
            },
          ],
        },
      },
    },
    kimi: {
      k3: {
        contextWindow: 1_048_576,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.3,
          input: 3,
          output: 15,
        },
      },
      "k3-256k": {
        contextWindow: 262_144,
        inputModalities: ["text", "image"],
        maxOutputTokens: 64_000,
        pricing: {
          cachedInput: 0.3,
          input: 3,
          output: 15,
        },
      },
    },
  }

  private readonly modelCatalog: BuiltinProviderModelCatalog

  constructor() {
    this.modelCatalog = BuiltinProviderModelRegistry.catalog
  }

  getModelConfig(
    providerName: string,
    modelName: string,
  ): BuiltinProviderModelConfig | undefined {
    return this.modelCatalog[this.normalizeKey(providerName)]?.[
      this.normalizeKey(modelName)
    ]
  }

  getModelIds(providerName: string): Array<string> {
    return Object.keys(this.modelCatalog[this.normalizeKey(providerName)] ?? {})
  }

  private normalizeKey(value: string): string {
    return value.trim().toLowerCase()
  }
}

export const builtinProviderModelRegistry = new BuiltinProviderModelRegistry()
