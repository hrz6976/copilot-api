import type {
  TokenUsagePricingConfig,
  TokenUsagePricingTier,
} from "~/lib/config"

import {
  normalizeToken,
  type TokenUsageSource,
  type UsageTokens,
} from "./store"

export interface CalculatedTokenUsageCost {
  currency: string
  source: string
  total_cost_nanos: number
}

interface TokenUsageCostInput extends UsageTokens {
  model: string
  pricing?: TokenUsagePricingConfig | null
  pricingCurrency?: string | null
  providerName?: string | null
  source: TokenUsageSource
}

interface ResolvedPricing {
  pricing: TokenUsagePricingConfig
  source: string
}

const COST_NANOS_PER_UNIT = 1_000_000_000
const COST_NANOS_PER_TOKEN_AT_ONE_PER_MILLION = 1_000
const COPILOT_NANO_AIU_PER_USD = 100_000_000_000
const COPILOT_NANO_AIU_TO_COST_NANOS =
  COST_NANOS_PER_UNIT / COPILOT_NANO_AIU_PER_USD
const BUILTIN_PROVIDER_CURRENCIES: Record<string, string> = {
  cloudgpt: "USD",
  codex: "USD",
  dashscope: "CNY",
  deepseek: "CNY",
  "opencode-go": "USD",
}

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
const CLOUDGPT_GROK_FAST_PRICING: TokenUsagePricingConfig = {
  cachedInput: 0.05,
  input: 0.2,
  output: 0.5,
}

const BUILTIN_PROVIDER_PRICING: Record<
  string,
  Record<string, TokenUsagePricingConfig>
> = {
  cloudgpt: {
    "codex-mini-20250516": {
      cachedInput: 0.375,
      input: 1.5,
      output: 6,
    },
    "deepseek-r1": {
      input: 1.35,
      output: 5.4,
    },
    "deepseek-r1-0528": {
      input: 1.35,
      output: 5.4,
    },
    "deepseek-v3-0324": {
      input: 1.14,
      output: 4.56,
    },
    "deepseek-v3.1": {
      input: 0.56,
      output: 1.68,
    },
    "deepseek-v3.2": {
      input: 0.58,
      output: 1.68,
    },
    "deepseek-v3.2-speciale": {
      input: 0.58,
      output: 1.68,
    },
    "deepseek-v4-flash": {
      input: 0.19,
      output: 0.51,
    },
    "deepseek-v4-pro": {
      input: 1.74,
      output: 3.48,
    },
    "gpt-4.1-20250414": {
      cachedInput: 0.5,
      input: 2,
      output: 8,
    },
    "gpt-4.1-mini-20250414": {
      cachedInput: 0.1,
      input: 0.4,
      output: 1.6,
    },
    "gpt-4.1-nano-20250414": {
      cachedInput: 0.025,
      input: 0.1,
      output: 0.4,
    },
    "gpt-4o-20240513": {
      input: 5,
      output: 15,
    },
    "gpt-4o-20240806": {
      cachedInput: 1.25,
      input: 2.5,
      output: 10,
    },
    "gpt-4o-20241120": {
      cachedInput: 1.25,
      input: 2.5,
      output: 10,
    },
    "gpt-4o-mini-20240718": {
      cachedInput: 0.075,
      input: 0.15,
      output: 0.6,
    },
    "gpt-5-20250807": CLOUDGPT_GPT5_PRICING,
    "gpt-5-chat-20250807": CLOUDGPT_GPT5_PRICING,
    "gpt-5-chat-20251003": CLOUDGPT_GPT5_PRICING,
    "gpt-5-codex-20250915": CLOUDGPT_GPT5_PRICING,
    "gpt-5-mini-20250807": CLOUDGPT_GPT5_MINI_PRICING,
    "gpt-5-nano-20250807": CLOUDGPT_GPT5_NANO_PRICING,
    "gpt-5-pro-20251006": {
      input: 15,
      output: 120,
    },
    "gpt-5.1-20251113": CLOUDGPT_GPT5_PRICING,
    "gpt-5.1-chat-20251113": CLOUDGPT_GPT5_PRICING,
    "gpt-5.1-codex-20251113": CLOUDGPT_GPT5_PRICING,
    "gpt-5.1-codex-max-20251204": CLOUDGPT_GPT5_PRICING,
    "gpt-5.1-codex-mini-20251113": CLOUDGPT_GPT5_MINI_PRICING,
    "gpt-5.2-20251211": CLOUDGPT_GPT52_PRICING,
    "gpt-5.2-chat-20251211": CLOUDGPT_GPT52_PRICING,
    "gpt-5.2-chat-20260210": CLOUDGPT_GPT52_PRICING,
    "gpt-5.2-codex-20260114": CLOUDGPT_GPT52_PRICING,
    "gpt-5.3-chat-20260303": CLOUDGPT_GPT52_PRICING,
    "gpt-5.3-codex-20260224": CLOUDGPT_GPT52_PRICING,
    "gpt-5.4-20260305": CLOUDGPT_GPT54_PRICING,
    "gpt-5.4-mini-20260317": {
      cachedInput: 0.075,
      input: 0.75,
      output: 4.5,
    },
    "gpt-5.4-nano-20260317": {
      cachedInput: 0.02,
      input: 0.2,
      output: 1.25,
    },
    "gpt-5.4-pro-20260305": CLOUDGPT_GPT54_PRO_PRICING,
    "gpt-5.5-20260424": CLOUDGPT_GPT55_PRICING,
    "gpt-chat-latest-20260505": CLOUDGPT_GPT52_PRICING,
    "grok-3": {
      cachedInput: 0.75,
      input: 3,
      output: 15,
    },
    "grok-3-mini": {
      cachedInput: 0.075,
      input: 0.3,
      output: 0.5,
    },
    "grok-4": {
      cachedInput: 0.75,
      input: 3,
      output: 15,
    },
    "grok-4-1-fast-non-reasoning": CLOUDGPT_GROK_FAST_PRICING,
    "grok-4-1-fast-reasoning": CLOUDGPT_GROK_FAST_PRICING,
    "grok-4-20-non-reasoning": {
      input: 2,
      output: 6,
    },
    "grok-4-20-reasoning": {
      input: 2,
      output: 6,
    },
    "grok-4-fast-non-reasoning": CLOUDGPT_GROK_FAST_PRICING,
    "grok-4-fast-reasoning": CLOUDGPT_GROK_FAST_PRICING,
    "grok-4.3": {
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
    "grok-code-fast-1": {
      cachedInput: 0.02,
      input: 0.2,
      output: 1.5,
    },
    "kimi-k2-thinking": {
      cachedInput: 0.15,
      input: 0.6,
      output: 2.5,
    },
    "kimi-k2.5": {
      cachedInput: 0.1,
      input: 0.6,
      output: 3,
    },
    "kimi-k2.6": {
      cachedInput: 0.16,
      input: 0.95,
      output: 4,
    },
    "llama-3.3-70b-instruct": {
      input: 0.71,
      output: 0.71,
    },
    "llama-4-maverick-17b-128e-instruct-fp8": {
      input: 0.25,
      output: 1,
    },
    "o1-20241217": {
      cachedInput: 7.5,
      input: 15,
      output: 60,
    },
    "o3-20250416": {
      cachedInput: 0.5,
      input: 2,
      output: 8,
    },
    "o3-deep-research-20250626": {
      cachedInput: 2.5,
      input: 10,
      output: 40,
    },
    "o3-mini-20250131": {
      cachedInput: 0.55,
      input: 1.1,
      output: 4.4,
    },
    "o3-pro-20250610": {
      input: 20,
      output: 80,
    },
    "o4-mini-20250416": {
      cachedInput: 0.275,
      input: 1.1,
      output: 4.4,
    },
  },
  codex: {
    "gpt-5.3-codex": {
      cachedInput: 0.175,
      input: 1.75,
      output: 14,
    },
    "gpt-5.4": {
      cachedInput: 0.25,
      input: 2.5,
      output: 15,
    },
    "gpt-5.4-mini": {
      cachedInput: 0.075,
      input: 0.75,
      output: 4.5,
    },
    "gpt-5.5": {
      cachedInput: 0.5,
      input: 5,
      output: 30,
    },
    "gpt-5.6-sol": {
      cachedInput: 0.5,
      input: 5,
      output: 30,
    },
    "gpt-5.6-terra": {
      cachedInput: 0.25,
      input: 2.5,
      output: 15,
    },
    "gpt-5.6-luna": {
      cachedInput: 0.1,
      input: 1,
      output: 6,
    },
  },
  dashscope: {
    "glm-5.1": {
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
    "glm-5.2": {
      cachedInput: 2,
      cacheCreationInput: 10,
      explicitCachedInput: 0.8,
      input: 8,
      output: 28,
    },
    "qwen3.7-max": {
      cachedInput: 2.4,
      cacheCreationInput: 15,
      explicitCachedInput: 1.2,
      input: 12,
      output: 36,
    },
    "qwen3.7-plus": {
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
  deepseek: {
    "deepseek-v4-flash": {
      cachedInput: 0.02,
      input: 1,
      output: 2,
    },
    "deepseek-v4-pro": {
      cachedInput: 0.025,
      input: 3,
      output: 6,
    },
  },
  "opencode-go": {
    "glm-5.2": {
      cachedInput: 0.26,
      input: 1.4,
      output: 4.4,
    },
    "deepseek-v4-flash": {
      cachedInput: 0.0028,
      input: 0.14,
      output: 0.28,
    },
    "deepseek-v4-pro": {
      cachedInput: 0.0145,
      input: 1.74,
      output: 3.48,
    },
    "kimi-k2.7-code": {
      cachedInput: 0.19,
      input: 0.95,
      output: 4,
    },
    "mimo-v2.5": {
      cachedInput: 0.0028,
      input: 0.14,
      output: 0.28,
    },
    "mimo-v2.5-pro": {
      cachedInput: 0.0145,
      input: 1.74,
      output: 3.48,
    },
    "qwen3.7-plus": {
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
    "qwen3.7-max": {
      cacheCreationInput: 3.125,
      cachedInput: 0.5,
      input: 2.5,
      output: 7.5,
    },
    "minimax-m2.5": {
      cachedInput: 0.03,
      input: 0.3,
      output: 1.2,
    },
    "minimax-m3": {
      tiers: [
        {
          cachedInput: 0.02,
          input: 0.1,
          maxInputTokens: 200_000,
          output: 0.4,
        },
        {
          cachedInput: 0.04,
          input: 0.2,
          maxInputTokens: 512_000,
          output: 0.8,
        },
      ],
    },
  },
}

export function resolveTokenUsageCost(
  input: TokenUsageCostInput,
): CalculatedTokenUsageCost | null {
  if (input.source === "copilot") {
    return resolveCopilotCost(input)
  }

  const providerName = input.providerName?.trim()
  if (!providerName) {
    return null
  }

  const resolvedPricing = resolveProviderPricing(
    providerName,
    input.model,
    input.pricing,
  )
  if (!resolvedPricing) {
    return null
  }

  const pricing = resolvePricingTier(
    resolvedPricing.pricing,
    getInputTokenTotal(input),
  )
  const currency = resolveProviderCurrency(providerName, input.pricingCurrency)
  if (!currency) {
    return null
  }

  const inputPrice = normalizePrice(pricing.input)
  const outputPrice = normalizePrice(pricing.output)
  const cacheReadPrice = resolveCacheReadPrice(pricing, input)
  const cacheCreationPrice = resolveCacheCreationPrice(pricing)

  const totalCostNanos =
    costNanosForTokens(input.input_tokens, inputPrice)
    + costNanosForTokens(input.output_tokens, outputPrice)
    + costNanosForTokens(input.cache_read_input_tokens, cacheReadPrice)
    + costNanosForTokens(input.cache_creation_input_tokens, cacheCreationPrice)

  if (totalCostNanos <= 0) {
    return null
  }

  return {
    currency,
    source: resolvedPricing.source,
    total_cost_nanos: totalCostNanos,
  }
}

export function getCostAmount(totalCostNanos: number): number {
  return totalCostNanos / COST_NANOS_PER_UNIT
}

function resolveCopilotCost(
  input: TokenUsageCostInput,
): CalculatedTokenUsageCost | null {
  const totalNanoAiu = normalizeToken(input.total_nano_aiu)
  if (totalNanoAiu <= 0) {
    return null
  }

  const totalCostNanos = Math.round(
    totalNanoAiu * COPILOT_NANO_AIU_TO_COST_NANOS,
  )
  if (totalCostNanos <= 0) {
    return null
  }

  return {
    currency: "USD",
    source: "copilot_aiu",
    total_cost_nanos: totalCostNanos,
  }
}

function resolveProviderPricing(
  providerName: string,
  model: string,
  configuredPricing: TokenUsagePricingConfig | null | undefined,
): ResolvedPricing | null {
  if (configuredPricing) {
    return {
      pricing: configuredPricing,
      source: "config",
    }
  }

  const builtinPricing =
    BUILTIN_PROVIDER_PRICING[providerName.toLowerCase()]?.[model.toLowerCase()]
  if (!builtinPricing) {
    return null
  }

  return {
    pricing: builtinPricing,
    source: "builtin",
  }
}

function resolvePricingTier(
  pricing: TokenUsagePricingConfig,
  inputTokenTotal: number,
): TokenUsagePricingTier {
  const tiers = pricing.tiers
    ?.filter((tier) => typeof tier === "object" && tier !== null)
    .toSorted((a, b) => normalizeTierMax(a) - normalizeTierMax(b))

  const selectedTier =
    tiers?.find((tier) => inputTokenTotal <= normalizeTierMax(tier))
    ?? tiers?.at(-1)

  return {
    ...pricing,
    ...selectedTier,
  }
}

function normalizeTierMax(tier: TokenUsagePricingTier): number {
  const maxInputTokens = tier.maxInputTokens
  return (
      typeof maxInputTokens === "number"
        && Number.isFinite(maxInputTokens)
        && maxInputTokens > 0
    ) ?
      maxInputTokens
    : Number.POSITIVE_INFINITY
}

function getInputTokenTotal(input: UsageTokens): number {
  return (
    normalizeToken(input.input_tokens)
    + normalizeToken(input.cache_read_input_tokens)
    + normalizeToken(input.cache_creation_input_tokens)
  )
}

function normalizePrice(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ?
      value
    : null
}

function resolveProviderCurrency(
  providerName: string,
  configuredCurrency: string | null | undefined,
): string | null {
  const currency =
    configuredCurrency?.trim().toUpperCase()
    || BUILTIN_PROVIDER_CURRENCIES[providerName.toLowerCase()]
  return currency || null
}

function resolveCacheCreationPrice(
  pricing: TokenUsagePricingTier,
): number | null {
  return normalizePrice(pricing.cacheCreationInput)
}

function resolveCacheReadPrice(
  pricing: TokenUsagePricingTier,
  input: UsageTokens,
): number | null {
  const hasCacheCreationSignal =
    input.cache_creation_input_tokens !== undefined
    && input.cache_creation_input_tokens !== null

  if (hasCacheCreationSignal) {
    return normalizePrice(pricing.explicitCachedInput)
  }

  return normalizePrice(pricing.cachedInput)
}

function costNanosForTokens(
  tokens: number | null | undefined,
  pricePerMillionTokens: number | null,
): number {
  if (pricePerMillionTokens === null) {
    return 0
  }

  return Math.round(
    normalizeToken(tokens)
      * pricePerMillionTokens
      * COST_NANOS_PER_TOKEN_AT_ONE_PER_MILLION,
  )
}
