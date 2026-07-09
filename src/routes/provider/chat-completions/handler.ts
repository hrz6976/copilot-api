import { events } from "fetch-event-stream"
import type { Context } from "hono"

import { streamSSE } from "hono/streaming"

import {
  type ModelConfig,
  type ResolvedProviderConfig,
  resolveEffectiveProviderConfig,
} from "~/lib/config"
import { logCodexRateLimitsEvent } from "~/lib/codex-rate-limit"
import { applyDashScopePreserveThinkingDefault } from "~/lib/dashscope"
import {
  applyMissingExtraBody,
  applyProviderContextCache,
  applyProviderStreamOptions,
} from "~/lib/provider-payload"
import { HTTPError } from "~/lib/error"
import { createHandlerLogger, debugJson } from "~/lib/logger"
import { resolveProviderConfig } from "~/lib/provider-resolver"
import {
  createProviderTokenUsageRecorder,
  normalizeOpenAIUsage,
  type UsageTokens,
} from "~/lib/token-usage"
import type {
  AnthropicResponse,
  AnthropicStreamEventData,
} from "~/routes/messages/anthropic-types"
import {
  applyResponsesApiContextManagement,
  compactInputByLatestCompaction,
} from "~/routes/responses/utils"
import {
  type ChatStreamTranslationError,
  createChatStreamTranslationState,
  translateAnthropicResponseToOpenAIChat,
  translateAnthropicStreamEventToOpenAIResult,
  translateOpenAIChatToAnthropicMessages,
} from "~/routes/translation/chat-to-anthropic"
import {
  createResponsesToChatStreamStates,
  translateOpenAIChatToResponsesPayload,
  translateResponsesResultToOpenAIChat,
  translateResponsesStreamEventToOpenAIResult,
} from "~/routes/translation/chat-to-responses"
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"
import { forwardCodexResponses } from "~/services/codex/create-responses"
import { getModels as getCodexModels } from "~/services/codex/get-models"
import type {
  ResponsesResult,
  ResponsesStream,
  ResponseStreamEvent,
} from "~/services/copilot/create-responses"
import {
  createProviderProxyResponse,
  forwardProviderChatCompletions,
  forwardProviderMessages,
  forwardProviderResponses,
} from "~/services/providers/provider-proxy"

const logger = createHandlerLogger("provider-chat-completions-handler")

export async function handleProviderChatCompletionsForProvider(
  c: Context,
  options: {
    payload: ChatCompletionsPayload
    provider: string
  },
): Promise<Response> {
  const { payload, provider } = options
  const providerConfig = await resolveProviderConfig(provider)
  if (!providerConfig) {
    return c.json(
      {
        error: {
          message: `Provider '${provider}' not found or disabled`,
          type: "invalid_request_error",
        },
      },
      404,
    )
  }

  const effectiveProviderConfig = resolveEffectiveProviderConfig(
    providerConfig,
    payload.model,
  )
  const effectiveType = effectiveProviderConfig.type
  const modelConfig = providerConfig.models?.[payload.model]
  applyProviderModelDefaults(payload, modelConfig)

  if (effectiveType === "openai-compatible") {
    return await handleOpenAICompatibleProviderChatCompletions(c, {
      modelConfig,
      payload,
      provider,
      providerConfig: effectiveProviderConfig,
    })
  }

  if (effectiveType === "openai-responses") {
    return await handleOpenAIResponsesProviderChatCompletions(c, {
      modelConfig,
      payload,
      provider,
      providerConfig: effectiveProviderConfig,
    })
  }

  if (effectiveType === "anthropic") {
    return await handleAnthropicProviderChatCompletions(c, {
      modelConfig,
      payload,
      provider,
      providerConfig: effectiveProviderConfig,
    })
  }

  return c.json(
    {
      error: {
        message: `Provider '${provider}' does not support the /v1/chat/completions endpoint`,
        type: "invalid_request_error",
      },
    },
    400,
  )
}

const handleOpenAICompatibleProviderChatCompletions = async (
  c: Context,
  options: {
    modelConfig: ModelConfig | undefined
    payload: ChatCompletionsPayload
    provider: string
    providerConfig: ResolvedProviderConfig
  },
): Promise<Response> => {
  const { modelConfig, payload, provider, providerConfig } = options
  applyMissingExtraBody(payload, {
    extraBody: modelConfig?.extraBody,
  })
  applyProviderStreamOptions(payload)
  applyDashScopePreserveThinkingDefault(
    payload as unknown as Record<string, unknown>,
    providerConfig,
  )
  applyProviderContextCache(payload, modelConfig, providerConfig)

  debugJson(logger, "provider.chat_completions.request", {
    payload,
    provider,
  })

  const upstreamResponse = await forwardProviderChatCompletions(
    providerConfig,
    payload,
    c.req.raw.headers,
  )

  if (!upstreamResponse.ok) {
    logger.error("Failed to create provider chat completions", {
      provider,
      statusCode: upstreamResponse.status,
    })
    throw new HTTPError(
      `Failed to create ${provider} chat completions`,
      upstreamResponse,
    )
  }

  const recordUsage = createProviderChatCompletionsUsageRecorder(
    payload,
    provider,
    modelConfig,
    providerConfig.pricingCurrency,
  )
  const contentType = upstreamResponse.headers.get("content-type") ?? ""
  const isStreamingResponse =
    Boolean(payload.stream) && contentType.includes("text/event-stream")

  if (isStreamingResponse) {
    return streamProviderChatCompletions(c, upstreamResponse, {
      provider,
      recordUsage,
    })
  }

  const responseBody = (await upstreamResponse
    .clone()
    .json()) as ChatCompletionResponse
  recordUsage(normalizeOpenAIUsage(responseBody.usage))

  debugJson(logger, "provider.chat_completions.response", responseBody)
  return createProviderProxyResponse(upstreamResponse)
}

const handleOpenAIResponsesProviderChatCompletions = async (
  c: Context,
  options: {
    modelConfig: ModelConfig | undefined
    payload: ChatCompletionsPayload
    provider: string
    providerConfig: ResolvedProviderConfig
  },
): Promise<Response> => {
  const { modelConfig, payload, provider, providerConfig } = options
  const responsesPayload = translateOpenAIChatToResponsesPayload(payload)
  applyMissingExtraBody(responsesPayload as Record<string, unknown>, {
    extraBody: modelConfig?.extraBody,
  })

  const model =
    providerConfig.name === "codex" ?
      getCodexModels().data.find((model) => model.id === responsesPayload.model)
    : undefined
  const shouldCompactInput = applyResponsesApiContextManagement(
    responsesPayload,
    model?.capabilities.limits.max_prompt_tokens,
    {
      compactThresholdRatio: 0.8,
      source: "responses",
    },
  )
  if (shouldCompactInput) {
    compactInputByLatestCompaction(responsesPayload)
  }

  debugJson(logger, "provider.chat_completions.responses.request", {
    payload: responsesPayload,
    provider,
  })

  const upstreamResponse =
    providerConfig.name === "codex" ?
      await forwardCodexResponses(
        responsesPayload,
        c.req.raw.headers,
        providerConfig.baseUrl,
      )
    : await forwardProviderResponses(
        providerConfig,
        responsesPayload,
        c.req.raw.headers,
      )

  if (upstreamResponse instanceof Response && !upstreamResponse.ok) {
    logger.error("Failed to create provider responses for chat completions", {
      provider,
      statusCode: upstreamResponse.status,
    })
    throw new HTTPError(
      `Failed to create ${provider} responses for chat completions`,
      upstreamResponse,
    )
  }

  const recordUsage = createProviderChatCompletionsUsageRecorder(
    payload,
    provider,
    modelConfig,
    providerConfig.pricingCurrency,
  )

  if (responsesPayload.stream) {
    const responsesStream =
      isResponsesStream(upstreamResponse) ? upstreamResponse
      : (
        upstreamResponse instanceof Response
        && (upstreamResponse.headers.get("content-type") ?? "").includes(
          "text/event-stream",
        )
      ) ?
        events(upstreamResponse)
      : null
    if (responsesStream) {
      return streamResponsesProviderChatCompletions(c, responsesStream, {
        payload,
        provider,
        providerConfig,
        recordUsage,
      })
    }
    // Stream requested but the upstream answered with JSON; fall through to
    // the non-streaming translation instead of emitting an empty stream
  }

  const responsesBody =
    upstreamResponse instanceof Response ?
      ((await upstreamResponse.json()) as ResponsesResult)
    : (upstreamResponse as ResponsesResult)
  const responseBody = translateResponsesResultToOpenAIChat(responsesBody)
  recordUsage(normalizeOpenAIUsage(responseBody.usage))
  debugJson(
    logger,
    "provider.chat_completions.responses.response",
    responseBody,
  )
  return c.json(responseBody)
}

const handleAnthropicProviderChatCompletions = async (
  c: Context,
  options: {
    modelConfig: ModelConfig | undefined
    payload: ChatCompletionsPayload
    provider: string
    providerConfig: ResolvedProviderConfig
  },
): Promise<Response> => {
  const { modelConfig, payload, provider, providerConfig } = options
  const anthropicPayload = translateOpenAIChatToAnthropicMessages(payload)
  applyMissingExtraBody(
    anthropicPayload as unknown as Record<string, unknown>,
    {
      extraBody: modelConfig?.extraBody,
    },
  )

  debugJson(logger, "provider.chat_completions.anthropic.request", {
    payload: anthropicPayload,
    provider,
  })

  const upstreamResponse = await forwardProviderMessages(
    providerConfig,
    anthropicPayload,
    c.req.raw.headers,
  )

  if (!upstreamResponse.ok) {
    logger.error("Failed to create provider messages for chat completions", {
      provider,
      statusCode: upstreamResponse.status,
    })
    throw new HTTPError(
      `Failed to create ${provider} messages for chat completions`,
      upstreamResponse,
    )
  }

  const recordUsage = createProviderChatCompletionsUsageRecorder(
    payload,
    provider,
    modelConfig,
    providerConfig.pricingCurrency,
  )
  const contentType = upstreamResponse.headers.get("content-type") ?? ""
  const isStreamingResponse =
    Boolean(anthropicPayload.stream)
    && contentType.includes("text/event-stream")

  if (isStreamingResponse) {
    return streamAnthropicProviderChatCompletions(c, upstreamResponse, {
      payload,
      provider,
      recordUsage,
    })
  }

  const anthropicBody = (await upstreamResponse.json()) as AnthropicResponse
  const responseBody = translateAnthropicResponseToOpenAIChat(anthropicBody)
  recordUsage(normalizeOpenAIUsage(responseBody.usage))
  debugJson(
    logger,
    "provider.chat_completions.anthropic.response",
    responseBody,
  )
  return c.json(responseBody)
}

const applyProviderModelDefaults = (
  payload: ChatCompletionsPayload,
  modelConfig: ModelConfig | undefined,
): void => {
  payload.temperature ??= modelConfig?.temperature
  payload.top_p ??= modelConfig?.topP
  payload.top_k ??= modelConfig?.topK
}

const createProviderChatCompletionsUsageRecorder = (
  payload: ChatCompletionsPayload,
  provider: string,
  modelConfig: ModelConfig | undefined,
  pricingCurrency: string | undefined,
) =>
  createProviderTokenUsageRecorder({
    endpoint: "chat_completions",
    model: payload.model,
    pricing: modelConfig?.pricing,
    pricingCurrency,
    providerName: provider,
  })

const streamAnthropicProviderChatCompletions = (
  c: Context,
  upstreamResponse: Response,
  options: {
    payload: ChatCompletionsPayload
    provider: string
    recordUsage: (usage: UsageTokens) => void
  },
): Response => {
  logger.debug("provider.chat_completions.anthropic.streaming", {
    provider: options.provider,
  })

  return streamSSE(c, async (stream) => {
    const streamState = createChatStreamTranslationState(options.payload.model)
    let usage: UsageTokens = {}

    try {
      for await (const chunk of events(upstreamResponse)) {
        debugJson(
          logger,
          "provider.chat_completions.anthropic.stream_chunk",
          chunk,
        )
        if (!chunk.data || chunk.data === "[DONE]") {
          if (chunk.data === "[DONE]") {
            break
          }
          continue
        }

        const parsedEvent = parseAnthropicStreamEvent(chunk.data)
        if (!parsedEvent) {
          continue
        }

        const translated = translateAnthropicStreamEventToOpenAIResult(
          parsedEvent,
          streamState,
        )
        for (const translatedChunk of translated.chunks) {
          if (translatedChunk.usage) {
            usage = normalizeOpenAIUsage(translatedChunk.usage)
          }
          await stream.writeSSE({
            data: JSON.stringify(translatedChunk),
          })
        }
        if (translated.error) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify(
              createOpenAIChatStreamErrorBody(translated.error),
            ),
          })
          break
        }
      }

      await stream.writeSSE({ data: "[DONE]" })
    } finally {
      options.recordUsage(usage)
    }
  })
}

const streamResponsesProviderChatCompletions = (
  c: Context,
  upstreamResponse: ResponsesStream,
  options: {
    payload: ChatCompletionsPayload
    provider: string
    providerConfig: ResolvedProviderConfig
    recordUsage: (usage: UsageTokens) => void
  },
): Response => {
  logger.debug("provider.chat_completions.responses.streaming", {
    provider: options.provider,
  })

  return streamSSE(c, async (stream) => {
    const { responsesState, chatState } = createResponsesToChatStreamStates(
      options.payload.model,
    )
    let usage: UsageTokens = {}

    try {
      for await (const chunk of upstreamResponse) {
        debugJson(
          logger,
          "provider.chat_completions.responses.stream_chunk",
          chunk,
        )

        if (!chunk.data || chunk.data === "[DONE]") {
          if (chunk.data === "[DONE]") {
            break
          }
          continue
        }

        const parsedEvent = parseResponsesStreamEvent(
          chunk.data,
          options.providerConfig,
        )
        if (!parsedEvent) {
          continue
        }

        if (parsedEvent.type === "error") {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify(
              createOpenAIChatStreamErrorBody({
                code: parsedEvent.error?.code ?? parsedEvent.code,
                message: parsedEvent.error?.message ?? parsedEvent.message,
                param: parsedEvent.param,
                type: parsedEvent.error?.type,
              }),
            ),
          })
          break
        }

        const translated = translateResponsesStreamEventToOpenAIResult(
          parsedEvent,
          responsesState,
          chatState,
        )
        for (const translatedChunk of translated.chunks) {
          if (translatedChunk.usage) {
            usage = normalizeOpenAIUsage(translatedChunk.usage)
          }
          await stream.writeSSE({
            data: JSON.stringify(translatedChunk),
          })
        }
        if (translated.error) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify(
              createOpenAIChatStreamErrorBody(translated.error),
            ),
          })
          break
        }

        if (isTerminalResponsesEvent(parsedEvent)) {
          break
        }
      }

      await stream.writeSSE({ data: "[DONE]" })
    } finally {
      options.recordUsage(usage)
    }
  })
}

const streamProviderChatCompletions = (
  c: Context,
  upstreamResponse: Response,
  options: {
    provider: string
    recordUsage: (usage: UsageTokens) => void
  },
): Response => {
  logger.debug("provider.chat_completions.streaming", {
    provider: options.provider,
  })
  return streamSSE(c, async (stream) => {
    let usage: UsageTokens = {}

    try {
      for await (const chunk of events(upstreamResponse)) {
        debugJson(logger, "provider.chat_completions.stream_chunk", chunk)
        if (chunk.data && chunk.data !== "[DONE]") {
          const parsedChunk = parseChatCompletionChunkData(chunk.data)
          if (parsedChunk?.usage) {
            usage = normalizeOpenAIUsage(parsedChunk.usage)
          }
        }

        await stream.writeSSE({
          event: chunk.event,
          data: chunk.data ?? "",
        })
      }
    } finally {
      options.recordUsage(usage)
    }
  })
}

const parseAnthropicStreamEvent = (
  data: string,
): AnthropicStreamEventData | null => {
  try {
    return JSON.parse(data) as AnthropicStreamEventData
  } catch (error) {
    logger.error("provider.chat_completions.anthropic.parse_chunk_error", {
      data,
      error,
    })
    return null
  }
}

const parseResponsesStreamEvent = (
  data: string,
  providerConfig: ResolvedProviderConfig,
): ResponseStreamEvent | null => {
  try {
    const parsed = JSON.parse(data) as ResponseStreamEvent
    if (providerConfig.name === "codex") {
      logCodexRateLimitsEvent(parsed)
    }
    return parsed
  } catch (error) {
    logger.error("provider.chat_completions.responses.parse_chunk_error", {
      provider: providerConfig.name,
      data,
      error,
    })
    return null
  }
}

const isTerminalResponsesEvent = (event: ResponseStreamEvent): boolean =>
  event.type === "response.completed"
  || event.type === "response.failed"
  || event.type === "response.incomplete"
  || event.type === "error"

const isResponsesStream = (value: unknown): value is ResponsesStream =>
  Boolean(value)
  && typeof (value as ResponsesStream)[Symbol.asyncIterator] === "function"

const parseChatCompletionChunkData = (
  data: string,
): ChatCompletionChunk | null => {
  try {
    return JSON.parse(data) as ChatCompletionChunk
  } catch {
    return null
  }
}

const createOpenAIChatStreamErrorBody = (
  error: ChatStreamTranslationError,
) => ({
  error: {
    message: error.message,
    type: error.type ?? "api_error",
    ...(error.code !== undefined ? { code: error.code } : {}),
    ...(error.param !== undefined ? { param: error.param } : {}),
  },
})
