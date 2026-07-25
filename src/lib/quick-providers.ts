import type {
  ProviderAuthType,
  ProviderTransport,
  ProviderType,
} from "./config"

export interface QuickProviderConfig {
  type: ProviderType
  baseUrl: string
  pricingCurrency: string
  editableType: boolean
  authType?: ProviderAuthType
  requiresApiKey?: boolean
  transport?: ProviderTransport
}

export const QUICK_PROVIDER_CONFIGS = {
  "opencode-go": {
    type: "openai-compatible",
    baseUrl: "https://opencode.ai/zen/go",
    pricingCurrency: "USD",
    editableType: false,
  },
  deepseek: {
    type: "anthropic",
    baseUrl: "https://api.deepseek.com/anthropic",
    pricingCurrency: "CNY",
    editableType: true,
  },
  dashscope: {
    type: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
    pricingCurrency: "CNY",
    editableType: true,
  },
  cloudgpt: {
    type: "openai-compatible",
    baseUrl: "https://cloudgpt-openai.azure-api.net/openai",
    pricingCurrency: "USD",
    // Endpoint routing is resolved per model from the builtin catalog, so
    // there is no single provider type to choose
    editableType: false,
    authType: "azure-cli",
    requiresApiKey: false,
  },
  llmapi: {
    type: "openai-compatible",
    baseUrl: "https://fe-26.qas.bing.net/sdf",
    pricingCurrency: "USD",
    editableType: false,
    authType: "llmapi-broker",
    requiresApiKey: false,
    transport: "llmapi",
  },
  openrouter: {
    type: "anthropic",
    baseUrl: "https://openrouter.ai/api",
    pricingCurrency: "USD",
    editableType: false,
  },
} satisfies Record<string, QuickProviderConfig>

export type QuickProviderName = keyof typeof QUICK_PROVIDER_CONFIGS
