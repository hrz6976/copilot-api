import type { ProviderAuthType, ProviderType } from "./config"

export interface QuickProviderConfig {
  type: ProviderType
  baseUrl: string
  pricingCurrency: string
  editableType: boolean
  authType?: ProviderAuthType
  requiresApiKey?: boolean
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
    editableType: true,
    authType: "azure-cli",
    requiresApiKey: false,
  },
  openrouter: {
    type: "anthropic",
    baseUrl: "https://openrouter.ai/api",
    pricingCurrency: "USD",
    editableType: false,
  },
} satisfies Record<string, QuickProviderConfig>

export type QuickProviderName = keyof typeof QUICK_PROVIDER_CONFIGS
