import consola from "consola"

import {
  type CloudGptChatProviderType,
  getCloudGptModelProviderType,
} from "~/services/cloudgpt/get-models"
import {
  getLlmApiModel,
  getLlmApiModelProviderType,
} from "~/services/llmapi/get-models"

import {
  SUPPORTED_PROVIDER_TYPES,
  getConfig,
  readEditableConfigFromDisk,
  reloadConfig,
  writeConfigToDisk,
  type ModelConfig,
  type ProviderAuthType,
  type ProviderConfig,
  type ProviderTransport,
  type ProviderType,
} from "./config-store"

export interface ResolvedProviderConfig {
  name: string
  type: ProviderType
  baseUrl: string
  apiKey: string
  authType: ProviderAuthType
  transport?: ProviderTransport
  // The valid authType explicitly set in config, if any; used to recompute
  // authType when a per-model type override changes the effective type
  configuredAuthType?: ProviderAuthType
  pricingCurrency?: string
  models?: Record<string, ModelConfig>
}

const OPENCODE_ANTHROPIC_MODEL_PATTERN = /^(?:qwen|minimax)/iu
const OPENCODE_RESPONSES_MODEL_PATTERN = /^(?:gpt|grok|muse-spark)(?:[-_.]|$)/iu

export function normalizeProviderBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/u, "")
}

export function isSupportedProviderType(value: string): value is ProviderType {
  return SUPPORTED_PROVIDER_TYPES.includes(value as ProviderType)
}

function getDefaultProviderAuthType(
  providerType: ProviderType,
): ProviderAuthType {
  return providerType === "anthropic" ? "x-api-key" : "authorization"
}

export function resolveProviderAuthType(
  providerName: string,
  authType: string | undefined,
  providerType: ProviderType,
): ProviderAuthType {
  const defaultAuthType = getDefaultProviderAuthType(providerType)
  if (authType === undefined) {
    return defaultAuthType
  }

  if (authType === "x-api-key") {
    return "x-api-key"
  }

  if (authType === "oauth2") {
    if (providerName === "codex") {
      return authType
    }

    consola.warn(
      `Provider ${providerName} has authType 'oauth2', which is only supported by the builtin codex provider, falling back to ${defaultAuthType}`,
    )
    return defaultAuthType
  }

  if (authType === "azure-cli") {
    if (providerName === "cloudgpt") {
      return authType
    }

    consola.warn(
      `Provider ${providerName} has authType 'azure-cli', which is only supported by the builtin cloudgpt provider, falling back to ${defaultAuthType}`,
    )
    return defaultAuthType
  }

  if (authType === "llmapi-broker") {
    if (providerName === "llmapi") {
      return authType
    }

    consola.warn(
      `Provider ${providerName} has authType 'llmapi-broker', which is only supported by the builtin llmapi provider, falling back to ${defaultAuthType}`,
    )
    return defaultAuthType
  }

  if (authType === "authorization" || authType === "azure-entra") {
    return authType
  }

  consola.warn(
    `Provider ${providerName} has invalid authType '${authType}', falling back to ${defaultAuthType}`,
  )
  return defaultAuthType
}

function isProviderApiKeyRequired(
  providerName: string,
  authType: ProviderAuthType,
): boolean {
  return (
    authType !== "azure-entra"
    && !(
      (providerName === "codex" && authType === "oauth2")
      || (providerName === "cloudgpt" && authType === "azure-cli")
      || (providerName === "llmapi" && authType === "llmapi-broker")
    )
  )
}

export function getRawProviderConfig(name: string): ProviderConfig | null {
  const providerName = name.trim()
  if (!providerName) {
    return null
  }

  const config = getConfig()
  return config.providers?.[providerName] ?? null
}

export function setProviderConfig(
  name: string,
  provider: ProviderConfig,
): ProviderConfig {
  const providerName = name.trim()
  if (!providerName) {
    throw new Error("Provider name must be a non-empty string")
  }

  if (isReservedProviderName(providerName)) {
    throw new Error(
      `Provider ${providerName} is reserved and cannot be configured in config.providers`,
    )
  }

  const editableConfig = readEditableConfigFromDisk()
  const nextConfig = {
    ...editableConfig,
    providers: {
      ...editableConfig.providers,
      [providerName]: provider,
    },
  }

  writeConfigToDisk(nextConfig)
  reloadConfig()
  return getRawProviderConfig(providerName) ?? provider
}

export function getProviderConfig(name: string): ResolvedProviderConfig | null {
  const providerName = name.trim()
  if (!providerName) {
    return null
  }

  if (isReservedProviderName(providerName)) {
    consola.warn(
      `Provider ${providerName} is reserved and cannot be configured in config.providers`,
    )
    return null
  }

  const provider = getRawProviderConfig(providerName)
  if (!provider) {
    return null
  }

  if (provider.enabled === false) {
    return null
  }

  const type = provider.type ?? "anthropic"
  if (!isSupportedProviderType(type)) {
    consola.warn(
      `Provider ${providerName} is ignored because type '${type}' is not supported`,
    )
    return null
  }

  const baseUrl = normalizeProviderBaseUrl(provider.baseUrl ?? "")
  const authType = resolveProviderAuthType(
    providerName,
    provider.authType,
    type,
  )
  const apiKey = (provider.apiKey ?? "").trim()
  const missingFields = [
    ...(baseUrl ? [] : ["baseUrl"]),
    ...(isProviderApiKeyRequired(providerName, authType) && !apiKey ?
      ["apiKey"]
    : []),
  ]

  if (missingFields.length > 0) {
    consola.warn(
      `Provider ${providerName} is enabled but missing ${missingFields.join(" or ")}`,
    )
    return null
  }

  return {
    name: providerName,
    type,
    baseUrl,
    apiKey,
    authType,
    transport: provider.transport === "llmapi" ? "llmapi" : "standard",
    configuredAuthType: provider.authType === authType ? authType : undefined,
    pricingCurrency: normalizePricingCurrency(provider.pricingCurrency),
    models: provider.models,
  }
}

export function resolveEffectiveProviderType(
  providerConfig: ResolvedProviderConfig,
  model: string,
  preferredBuiltinTypes?: Array<CloudGptChatProviderType>,
): ProviderType {
  const modelConfig = providerConfig.models?.[model]
  if (modelConfig?.type && isSupportedProviderType(modelConfig.type)) {
    return modelConfig.type
  }

  if (providerConfig.name === "opencode-go") {
    if (OPENCODE_ANTHROPIC_MODEL_PATTERN.test(model)) {
      return "anthropic"
    }
    if (OPENCODE_RESPONSES_MODEL_PATTERN.test(model)) {
      return "openai-responses"
    }
  }

  // The builtin CloudGPT catalog knows which endpoints each model supports,
  // so per-model routing does not need explicit config
  if (providerConfig.name === "cloudgpt") {
    const catalogType = getCloudGptModelProviderType(
      model,
      preferredBuiltinTypes,
    )
    if (catalogType) {
      return catalogType
    }
  }

  if (providerConfig.transport === "llmapi") {
    const catalogType =
      getLlmApiModelProviderType(model, preferredBuiltinTypes)
      ?? getLlmApiModelProviderType(model)
    if (catalogType) {
      return catalogType
    }
  }

  return providerConfig.type
}

export function getEffectiveProviderModelConfig(
  providerConfig: ResolvedProviderConfig,
  model: string,
): ModelConfig | undefined {
  const configuredModel = providerConfig.models?.[model]
  if (providerConfig.transport !== "llmapi") {
    return configuredModel
  }

  const catalogModel = getLlmApiModel(model)
  if (!catalogModel) {
    return configuredModel
  }

  const catalogConfig: ModelConfig = {
    type: catalogModel.provider_type,
    ...(catalogModel.pricing ? { pricing: catalogModel.pricing } : {}),
  }
  if (!configuredModel) {
    return catalogConfig
  }

  return {
    ...catalogConfig,
    ...configuredModel,
    pricing:
      catalogConfig.pricing || configuredModel.pricing ?
        {
          ...catalogConfig.pricing,
          ...configuredModel.pricing,
        }
      : undefined,
  }
}

// Applies a per-model type override to the provider config, recomputing
// authType for the effective type while honoring an explicitly configured one.
export function resolveEffectiveProviderConfig(
  providerConfig: ResolvedProviderConfig,
  model: string,
  preferredBuiltinTypes?: Array<CloudGptChatProviderType>,
): ResolvedProviderConfig {
  const effectiveType = resolveEffectiveProviderType(
    providerConfig,
    model,
    preferredBuiltinTypes,
  )
  if (effectiveType === providerConfig.type) {
    return providerConfig
  }

  return {
    ...providerConfig,
    type: effectiveType,
    authType: resolveProviderAuthType(
      providerConfig.name,
      providerConfig.configuredAuthType,
      effectiveType,
    ),
  }
}

function normalizePricingCurrency(
  value: string | undefined,
): string | undefined {
  const currency = value?.trim().toUpperCase()
  return currency || undefined
}

export function listEnabledProviders(): Array<string> {
  const config = getConfig()
  const providerNames = Object.keys(config.providers ?? {})
  return providerNames.filter((name) => getProviderConfig(name) !== null)
}

export function isReservedProviderName(name: string): boolean {
  return name.trim() === "copilot"
}
