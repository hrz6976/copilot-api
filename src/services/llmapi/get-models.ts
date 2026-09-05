import type { Model } from "~/lib/types/models"

export type LlmApiProviderType =
  | "anthropic"
  | "openai-compatible"
  | "openai-responses"

export interface LlmApiModelCompatibility {
  maxTokensParam?: "max_completion_tokens"
  unsupportedParams?: Array<"stop" | "stream_options">
}

interface LlmApiPricingTier {
  cachedInput?: number
  cacheCreationInput?: number
  explicitCachedInput?: number
  input?: number
  maxInputTokens?: number
  output?: number
}

interface LlmApiPricing extends LlmApiPricingTier {
  tiers?: LlmApiPricingTier[]
}

export interface LlmApiCatalogModel extends Model {
  provider_type: LlmApiProviderType
  supported_endpoints: Array<
    "/v1/chat/completions" | "/v1/messages" | "/v1/responses"
  >
  compatibility?: LlmApiModelCompatibility
  pricing?: LlmApiPricing
  pricing_currency?: string
  pricing_estimated?: boolean
  pricing_source?: string
  pricing_source_model?: string
  pricing_source_url?: string
}

interface LlmApiModelDefinition {
  id: string
  providerType: LlmApiProviderType
  vendor: string
}

interface LlmApiPricingEstimate {
  pricing: LlmApiPricing
  sourceModel: string
  sourcePath: string
}

const BASELLM_RAW_URL =
  "https://raw.githubusercontent.com/basellm/llm-metadata/main/dist/api/models"

const scalePrice = (price: number, multiplier: number): number =>
  Number((price * multiplier).toFixed(6))

const anthropicPricing = (
  sourceModel: string,
  input: number,
  output: number,
): LlmApiPricingEstimate => ({
  pricing: {
    cachedInput: scalePrice(input, 0.1),
    cacheCreationInput: scalePrice(input, 1.25),
    input,
    output,
  },
  sourceModel,
  sourcePath: `anthropic/${sourceModel}.json`,
})

const azurePricing = (
  sourceModel: string,
  input: number,
  output: number,
): LlmApiPricingEstimate => ({
  pricing: { input, output },
  sourceModel,
  sourcePath: `azure/${sourceModel}.json`,
})

const LLMAPI_PRICING_ESTIMATES: Record<string, LlmApiPricingEstimate> = {
  "dev-anthropic-claude-sonnet-4-5": anthropicPricing(
    "claude-sonnet-4-5",
    3,
    15,
  ),
  "dev-anthropic-claude-haiku-4-5": anthropicPricing("claude-haiku-4-5", 1, 5),
  "dev-anthropic-claude-opus-4-5": anthropicPricing("claude-opus-4-5", 5, 25),
  "dev-anthropic-claude-opus-4-6": anthropicPricing("claude-opus-4-6", 5, 25),
  "dev-anthropic-claude-sonnet-4-6": anthropicPricing(
    "claude-sonnet-4-6",
    3,
    15,
  ),
  "dev-anthropic-claude-opus-4-7": anthropicPricing("claude-opus-4-7", 5, 25),
  "dev-anthropic-claude-opus-4-8": anthropicPricing("claude-opus-4-8", 5, 25),
  "dev-anthropic-claude-fable-5": anthropicPricing("claude-fable-5", 10, 50),
  "dev-anthropic-claude-opus-5": anthropicPricing("claude-opus-5", 5, 25),
  "dev-anthropic-claude-sonnet-5": anthropicPricing("claude-sonnet-5", 2, 10),
  "dev-gpt-chat-latest-oai-priority": {
    pricing: { cachedInput: 1.25, input: 2.5, output: 10 },
    sourceModel: "gpt-4o",
    sourcePath: "azure/gpt-4o.json",
  },
  "dev-gpt-chat-latest-oai-standard": {
    pricing: { cachedInput: 1.25, input: 2.5, output: 10 },
    sourceModel: "gpt-4o",
    sourcePath: "azure/gpt-4o.json",
  },
  "dev-gpt-56-reasoning-sol-oai-standard": {
    pricing: {
      tiers: [
        {
          cachedInput: 0.5,
          input: 5,
          maxInputTokens: 272_000,
          output: 30,
        },
        { cachedInput: 1, input: 10, output: 45 },
      ],
    },
    sourceModel: "gpt-5.6-sol",
    sourcePath: "azure/gpt-5.6-sol.json",
  },
  "dev-gpt-56-reasoning-sol-oai-priority": {
    pricing: {
      tiers: [
        {
          cachedInput: 0.5,
          input: 5,
          maxInputTokens: 272_000,
          output: 30,
        },
        { cachedInput: 1, input: 10, output: 45 },
      ],
    },
    sourceModel: "gpt-5.6-sol",
    sourcePath: "azure/gpt-5.6-sol.json",
  },
  "dev-gpt-55-reasoning-oai-standard": {
    pricing: {
      tiers: [
        {
          cachedInput: 0.5,
          input: 5,
          maxInputTokens: 272_000,
          output: 30,
        },
        { cachedInput: 1, input: 10, output: 45 },
      ],
    },
    sourceModel: "gpt-5.5",
    sourcePath: "azure/gpt-5.5.json",
  },
  "dev-gpt-55-reasoning-oai-priority": {
    pricing: {
      tiers: [
        {
          cachedInput: 0.5,
          input: 5,
          maxInputTokens: 272_000,
          output: 30,
        },
        { cachedInput: 1, input: 10, output: 45 },
      ],
    },
    sourceModel: "gpt-5.5",
    sourcePath: "azure/gpt-5.5.json",
  },
  "dev-mai-code-1-flash": {
    pricing: { cachedInput: 0.075, input: 0.75, output: 4.5 },
    sourceModel: "mai-code-1-flash-picker",
    sourcePath: "github-copilot/mai-code-1-flash-picker.json",
  },
  "dev-mistral-7b-instruct-v02": {
    pricing: { input: 0.25, output: 0.25 },
    sourceModel: "open-mistral-7b",
    sourcePath: "mistral/open-mistral-7b.json",
  },
  "dev-mixtral-8x7b-instruct-v01": {
    pricing: { input: 0.7, output: 0.7 },
    sourceModel: "open-mixtral-8x7b",
    sourcePath: "mistral/open-mixtral-8x7b.json",
  },
  "dev-mistral-medium-3.5": {
    pricing: { input: 1.5, output: 7.5 },
    sourceModel: "mistral-medium-latest",
    sourcePath: "mistral/mistral-medium-latest.json",
  },
  "dev-mistral-7b-v01": {
    pricing: { input: 0.25, output: 0.25 },
    sourceModel: "open-mistral-7b",
    sourcePath: "mistral/open-mistral-7b.json",
  },
  "dev-phi-3-mini-128k-instruct": azurePricing(
    "phi-3-mini-128k-instruct",
    0.13,
    0.52,
  ),
  "dev-phi-3-small-128k-instruct": azurePricing(
    "phi-3-small-128k-instruct",
    0.15,
    0.6,
  ),
  "dev-phi-3-medium-128k-instruct": azurePricing(
    "phi-3-medium-128k-instruct",
    0.17,
    0.68,
  ),
  "dev-phi-4": azurePricing("phi-4", 0.125, 0.5),
  "dev-phi-35-moe-instruct": azurePricing("phi-3.5-moe-instruct", 0.16, 0.64),
  "dev-phi-35-mini-instruct": azurePricing("phi-3.5-mini-instruct", 0.13, 0.52),
  "dev-phi-4-mini-reasoning": azurePricing("phi-4-mini-reasoning", 0.075, 0.3),
  "dev-phi-4-reasoning": azurePricing("phi-4-reasoning", 0.125, 0.5),
  "dev-phi-4-reasoning-plus": azurePricing("phi-4-reasoning-plus", 0.125, 0.5),
  "dev-phi-4-mini-instruct": azurePricing("phi-4-mini", 0.075, 0.3),
  "dev-qwen-3-32b": {
    pricing: { input: 0.7, output: 2.8 },
    sourceModel: "qwen3-32b",
    sourcePath: "alibaba/qwen3-32b.json",
  },
  "dev-qwen-3-06b": {
    pricing: { input: 0.04, output: 0.16 },
    sourceModel: "qwen3-0.6b",
    sourcePath: "aliyun-bailian/qwen3-0.6b.json",
  },
  "dev-qwen-3-17b": {
    pricing: { input: 0.35, output: 1.4 },
    sourceModel: "qwen3-14b",
    sourcePath: "alibaba/qwen3-14b.json",
  },
  "dev-qwen-3-8b": {
    pricing: { input: 0.18, output: 0.7 },
    sourceModel: "qwen3-8b",
    sourcePath: "alibaba/qwen3-8b.json",
  },
  "dev-xai-grok-4.20-reasoning": {
    pricing: {
      tiers: [
        {
          cachedInput: 0.2,
          input: 1.25,
          maxInputTokens: 200_000,
          output: 2.5,
        },
        { cachedInput: 0.4, input: 2.5, output: 5 },
      ],
    },
    sourceModel: "grok-4.20-0309-reasoning",
    sourcePath: "xai/grok-4.20-0309-reasoning.json",
  },
  "dev-xai-grok-4.3": {
    pricing: {
      tiers: [
        {
          cachedInput: 0.2,
          input: 1.25,
          maxInputTokens: 200_000,
          output: 2.5,
        },
        { cachedInput: 0.4, input: 2.5, output: 5 },
      ],
    },
    sourceModel: "grok-4.3",
    sourcePath: "xai/grok-4.3.json",
  },
  "dev-xai-grok-4.5": {
    pricing: {
      tiers: [
        {
          cachedInput: 0.3,
          input: 2,
          maxInputTokens: 200_000,
          output: 6,
        },
        { cachedInput: 1, input: 4, output: 12 },
      ],
    },
    sourceModel: "grok-4.5",
    sourcePath: "xai/grok-4.5.json",
  },
}

const ANTHROPIC_MODEL_IDS = [
  "dev-anthropic-claude-sonnet-4-5",
  "dev-anthropic-claude-haiku-4-5",
  "dev-anthropic-claude-opus-4-5",
  "dev-anthropic-claude-opus-4-6",
  "dev-anthropic-claude-sonnet-4-6",
  "dev-anthropic-claude-opus-4-7",
  "dev-anthropic-claude-opus-4-8",
  "dev-anthropic-claude-fable-5",
  "dev-anthropic-claude-opus-5",
  "dev-anthropic-claude-sonnet-5",
] as const

const RESPONSES_MODEL_IDS = [
  "dev-gpt-chat-latest-oai-priority",
  "dev-gpt-chat-latest-oai-standard",
  "dev-gpt-56-reasoning-sol-oai-standard",
  "dev-gpt-56-reasoning-sol-oai-priority",
  "dev-gpt-55-reasoning-oai-standard",
  "dev-gpt-55-reasoning-oai-priority",
] as const

const CHAT_MODEL_DEFINITIONS = [
  ["dev-mai-code-1-flash", "Microsoft"],
  ["dev-mistral-7b-instruct-v02", "Mistral AI"],
  ["dev-mixtral-8x7b-instruct-v01", "Mistral AI"],
  ["dev-mistral-medium-3.5", "Mistral AI"],
  ["dev-mistral-7b-v01", "Mistral AI"],
  ["dev-phi-3-mini-128k-instruct", "Microsoft"],
  ["dev-phi-3-small-128k-instruct", "Microsoft"],
  ["dev-phi-3-medium-128k-instruct", "Microsoft"],
  ["dev-phi-4", "Microsoft"],
  ["dev-phi-35-moe-instruct", "Microsoft"],
  ["dev-phi-35-mini-instruct", "Microsoft"],
  ["dev-phi-4-mini-reasoning", "Microsoft"],
  ["dev-phi-4-reasoning", "Microsoft"],
  ["dev-phi-4-reasoning-plus", "Microsoft"],
  ["dev-phi-4-mini-instruct", "Microsoft"],
  ["dev-qwen-3-32b", "Alibaba"],
  ["dev-qwen-3-06b", "Alibaba"],
  ["dev-qwen-3-17b", "Alibaba"],
  ["dev-qwen-3-8b", "Alibaba"],
  ["dev-xai-grok-4.20-reasoning", "xAI"],
  ["dev-xai-grok-4.3", "xAI"],
  ["dev-xai-grok-4.5", "xAI"],
] as const

const MODEL_DEFINITIONS: LlmApiModelDefinition[] = [
  ...ANTHROPIC_MODEL_IDS.map((id) => ({
    id,
    providerType: "anthropic" as const,
    vendor: "Anthropic",
  })),
  ...RESPONSES_MODEL_IDS.map((id) => ({
    id,
    providerType: "openai-responses" as const,
    vendor: "OpenAI",
  })),
  ...CHAT_MODEL_DEFINITIONS.map(([id, vendor]) => ({
    id,
    providerType: "openai-compatible" as const,
    vendor,
  })),
]

const PROVIDER_ENDPOINTS: Record<
  LlmApiProviderType,
  LlmApiCatalogModel["supported_endpoints"]
> = {
  anthropic: ["/v1/messages"],
  "openai-compatible": ["/v1/chat/completions"],
  "openai-responses": ["/v1/responses"],
}

function createModel(definition: LlmApiModelDefinition): LlmApiCatalogModel {
  const pricingEstimate = LLMAPI_PRICING_ESTIMATES[definition.id]
  if (!pricingEstimate) {
    throw new Error(`Missing LLM API pricing estimate for ${definition.id}`)
  }
  const compatibility =
    definition.id === "dev-mai-code-1-flash" ?
      {
        maxTokensParam: "max_completion_tokens" as const,
        unsupportedParams: ["stop", "stream_options"] as const,
      }
    : undefined

  return {
    id: definition.id,
    name: definition.id,
    vendor: definition.vendor,
    version: definition.id,
    model_picker_enabled: true,
    preview: definition.id.includes("dev-"),
    provider_type: definition.providerType,
    supported_endpoints: PROVIDER_ENDPOINTS[definition.providerType],
    pricing: pricingEstimate.pricing,
    pricing_currency: "USD",
    pricing_estimated: true,
    pricing_source: "BaseLLM model metadata",
    pricing_source_model: pricingEstimate.sourceModel,
    pricing_source_url: `${BASELLM_RAW_URL}/${pricingEstimate.sourcePath}`,
    ...(compatibility ?
      {
        compatibility: {
          ...compatibility,
          unsupportedParams: [...compatibility.unsupportedParams],
        },
      }
    : {}),
    capabilities: {
      family: definition.id.replace(/^dev-/u, ""),
      type: "chat",
      supports: {
        vision: false,
        tool_calls: true,
        streaming: true,
        parallel_tool_calls: true,
        structured_outputs: false,
        dimensions: false,
      },
      limits: {
        max_context_window_tokens: 0,
        max_prompt_tokens: 0,
        max_output_tokens: 0,
        vision: {
          max_prompt_images: 0,
          max_prompt_image_size: 0,
          supported_media_types: [],
        },
      },
      object: "model_capabilities",
      tokenizer: "unknown",
    },
    object: "model",
  }
}

const MODELS = MODEL_DEFINITIONS.map(createModel)
const MODELS_BY_ID = new Map(MODELS.map((model) => [model.id, model]))

export const getLlmApiModel = (
  modelId: string,
): LlmApiCatalogModel | undefined => MODELS_BY_ID.get(modelId)

export const getLlmApiModelProviderType = (
  modelId: string,
  preferredTypes?: LlmApiProviderType[],
): LlmApiProviderType | undefined => {
  const type = getLlmApiModel(modelId)?.provider_type
  if (!type) {
    return undefined
  }
  return !preferredTypes || preferredTypes.includes(type) ? type : undefined
}

export const getModels = (options?: {
  models?: Record<
    string,
    {
      pricing?: LlmApiCatalogModel["pricing"]
    }
  >
  pricingCurrency?: string
}): {
  data: LlmApiCatalogModel[]
  object: "list"
} => ({
  data: MODELS.map((model) => {
    const configuredPricing = options?.models?.[model.id]?.pricing
    const mergedPricing =
      model.pricing || configuredPricing ?
        {
          ...model.pricing,
          ...configuredPricing,
        }
      : undefined
    const pricing =
      mergedPricing ?
        {
          ...mergedPricing,
          ...(mergedPricing.tiers ?
            { tiers: mergedPricing.tiers.map((tier) => ({ ...tier })) }
          : {}),
        }
      : undefined

    const vision = model.capabilities.limits.vision
    return {
      ...model,
      ...(pricing ? { pricing } : {}),
      ...(pricing ?
        {
          pricing_currency:
            configuredPricing && options?.pricingCurrency ?
              options.pricingCurrency
            : model.pricing_currency,
        }
      : {}),
      capabilities: {
        ...model.capabilities,
        supports: { ...model.capabilities.supports },
        limits: {
          ...model.capabilities.limits,
          ...(vision ?
            {
              vision: {
                ...vision,
                supported_media_types: [
                  ...(vision.supported_media_types ?? []),
                ],
              },
            }
          : {}),
        },
      },
      supported_endpoints: [...model.supported_endpoints],
    }
  }),
  object: "list",
})
