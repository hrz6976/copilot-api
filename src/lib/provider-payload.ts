import type { ModelConfig, ResolvedProviderConfig } from "~/lib/config"
import type { ChatCompletionsPayload } from "~/services/copilot/create-chat-completions"

import {
  applyOpenAICompatibleContextCache,
  isDashScopeAliyunProvider,
} from "~/lib/dashscope"

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
