import type { ModelConfig, ResolvedProviderConfig } from "~/lib/config"
import type { ChatCompletionsPayload } from "~/lib/types/chat-completions"

import {
  applyOpenAICompatibleContextCache,
  isDashScopeAliyunProvider,
} from "~/lib/dashscope"

const GPT_MODEL_SERIES_PATTERN = /^gpt-/u

// Fills payload keys from a model's extraBody config without overriding
// anything the client sent.
export const applyMissingExtraBody = (
  payload: Record<string, unknown>,
  options: { extraBody: Record<string, unknown> | undefined },
): void => {
  for (const [key, value] of Object.entries(options.extraBody ?? {})) {
    if (!Object.hasOwn(payload, key)) {
      payload[key] = value
    }
  }
}

export const applyProviderStreamOptions = (
  payload: ChatCompletionsPayload,
): void => {
  if (!payload.stream) {
    return
  }

  payload.stream_options = {
    ...(payload.stream_options ?? {}),
    include_usage: true,
  }
}

export const applyGptModelTokenLimitParam = (
  payload: ChatCompletionsPayload,
): void => {
  if (!isGptModelSeries(payload.model)) {
    return
  }

  if (payload.max_completion_tokens == null && payload.max_tokens != null) {
    payload.max_completion_tokens = payload.max_tokens
  }
  delete payload.max_tokens
}

export const isGptModelSeries = (model: string): boolean =>
  GPT_MODEL_SERIES_PATTERN.test(model.toLowerCase())

export const applyProviderContextCache = (
  payload: ChatCompletionsPayload,
  modelConfig: ModelConfig | undefined,
  providerConfig: ResolvedProviderConfig,
): void => {
  const isDashScopeProvider = isDashScopeAliyunProvider(providerConfig)
  const contextCacheEnabled = modelConfig?.contextCache ?? isDashScopeProvider
  if (contextCacheEnabled) {
    applyOpenAICompatibleContextCache(payload)
  }
}
