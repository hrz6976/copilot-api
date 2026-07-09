import type { Context } from "hono"

import { events } from "fetch-event-stream"
import { streamSSE } from "hono/streaming"

import { logCodexRateLimitsEvent } from "~/lib/codex-rate-limit"
import { applyDashScopePreserveThinkingDefault } from "~/lib/dashscope"
import {
  applyMissingExtraBody,
  applyProviderContextCache,
  applyProviderStreamOptions,
} from "~/lib/provider-payload"
import {
  type ModelConfig,
  type ResolvedProviderConfig,
  resolveEffectiveProviderConfig,
} from "~/lib/config"
import { HTTPError } from "~/lib/error"
import { createHandlerLogger, debugJson } from "~/lib/logger"
import { resolveProviderConfig } from "~/lib/provider-resolver"
import { requestContext } from "~/lib/request-context"
import {
  createProviderTokenUsageRecorder,
  normalizeResponsesUsage,
  type UsageTokens,
} from "~/lib/token-usage"
import {
  applyResponsesApiContextManagement,
  compactInputByLatestCompaction,
} from "~/routes/responses/utils"
import {
  createOpenAIChatToResponsesStreamState,
  finalizeOpenAIChatToResponsesStream,
  ResponsesToOpenAIChatTranslationError,
  translateOpenAIChatResponseToResponsesResult,
  translateOpenAIChatStreamChunkToResponsesEvents,
  translateResponsesPayloadToOpenAIChat,
} from "~/routes/translation/responses-to-chat"
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"
import type {
  ResponsesPayload,
  ResponsesResult,
  ResponseStreamEvent,
  ResponsesStream,
} from "~/services/copilot/create-responses"
import { forwardCodexResponses } from "~/services/codex/create-responses"
import { getModels as getCodexModels } from "~/services/codex/get-models"
import {
  createProviderProxyResponse,
  forwardProviderChatCompletions,
  forwardProviderResponses,
} from "~/services/providers/provider-proxy"
import type { ContentfulStatusCode } from "hono/utils/http-status"

const logger = createHandlerLogger("provider-responses-handler")

export async function handleProviderResponsesForProvider(
  c: Context,
  options: {
    payload: ResponsesPayload
    provider: string
  },
): Promise<Response> {
  const { payload, provider } = options
  debugJson(logger, "Responses request payload:", {
    payload,
    provider,
  })
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

  if (effectiveType === "openai-compatible") {
    return await handleOpenAICompatibleProviderResponses(c, {
      modelConfig,
      payload,
      provider,
      providerConfig: effectiveProviderConfig,
    })
  }

  if (effectiveType !== "openai-responses") {
    return c.json(
      {
        error: {
          message: `Provider '${provider}' does not support the /v1/responses endpoint`,
          type: "invalid_request_error",
        },
      },
      400,
    )
  }

  const model =
    providerConfig.name === "codex" ?
      getCodexModels().data.find((model) => model.id === payload.model)
    : undefined

  const maxPromptTokens = model?.capabilities.limits.max_prompt_tokens ?? 0
  // Smaller than the client compaction threshold, use server-side compaction to maintain cache hit rate
  applyResponsesApiContextManagement(payload, maxPromptTokens, 0.8)

  const contextManagement = payload.context_management
  debugJson(logger, "Translated Responses request payload:", {
    contextManagement,
    provider,
  })
  compactInputByLatestCompaction(payload)

  if (providerConfig.name === "codex") {
    const upstreamResponse = await forwardCodexResponses(
      payload,
      c.req.raw.headers,
      providerConfig.baseUrl,
    )
    const recordUsage = createProviderResponsesUsageRecorder(
      payload,
      provider,
      modelConfig,
      providerConfig.pricingCurrency,
    )

    if (payload.stream && isResponsesStream(upstreamResponse)) {
      return streamProviderResponses(c, upstreamResponse, {
        normalizeCodex: true,
        provider,
        recordUsage,
      })
    }

    const responseBody = upstreamResponse as ResponsesResult
    recordUsage(normalizeResponsesUsage(responseBody.usage))
    return c.json(responseBody)
  }

  const upstreamResponse = await forwardProviderResponses(
    providerConfig,
    payload,
    c.req.raw.headers,
  )

  if (!upstreamResponse.ok) {
    throw new HTTPError(
      `Failed to create ${provider} responses`,
      upstreamResponse,
    )
  }

  const recordUsage = createProviderResponsesUsageRecorder(
    payload,
    provider,
    modelConfig,
    providerConfig.pricingCurrency,
  )

  if (payload.stream) {
    return streamProviderResponses(c, getResponsesEvents(upstreamResponse), {
      normalizeCodex: false,
      provider,
      recordUsage,
    })
  }

  const responseBody = (await upstreamResponse
    .clone()
    .json()) as ResponsesResult
  recordUsage(normalizeResponsesUsage(responseBody.usage))

  return createProviderProxyResponse(upstreamResponse)
}

const handleOpenAICompatibleProviderResponses = async (
  c: Context,
  options: {
    modelConfig: ModelConfig | undefined
    payload: ResponsesPayload
    provider: string
    providerConfig: ResolvedProviderConfig
  },
): Promise<Response> => {
  const { modelConfig, payload, provider, providerConfig } = options
  let chatPayload: ChatCompletionsPayload
  try {
    chatPayload = translateResponsesPayloadToOpenAIChat(payload)
  } catch (error) {
    if (error instanceof ResponsesToOpenAIChatTranslationError) {
      return c.json(
        {
          error: {
            message: error.message,
            type: "invalid_request_error",
          },
        },
        400,
      )
    }
    throw error
  }

  chatPayload.temperature ??= modelConfig?.temperature
  chatPayload.top_p ??= modelConfig?.topP
  chatPayload.top_k ??= modelConfig?.topK
  applyMissingExtraBody(chatPayload, {
    extraBody: modelConfig?.extraBody,
  })
  applyProviderStreamOptions(chatPayload)
  applyDashScopePreserveThinkingDefault(
    chatPayload as unknown as Record<string, unknown>,
    providerConfig,
  )
  applyProviderContextCache(chatPayload, modelConfig, providerConfig)

  debugJson(logger, "provider.responses.openai_compatible.request", {
    payload: chatPayload,
    provider,
  })

  const upstreamResponse = await forwardProviderChatCompletions(
    providerConfig,
    chatPayload,
    c.req.raw.headers,
  )

  if (!upstreamResponse.ok) {
    throw new HTTPError(
      `Failed to create ${provider} chat completions for responses`,
      upstreamResponse,
    )
  }

  const recordUsage = createProviderResponsesUsageRecorder(
    payload,
    provider,
    modelConfig,
    providerConfig.pricingCurrency,
  )
  const contentType = upstreamResponse.headers.get("content-type") ?? ""
  const isStreamingResponse =
    Boolean(chatPayload.stream) && contentType.includes("text/event-stream")

  if (isStreamingResponse) {
    return streamOpenAICompatibleProviderResponses(c, upstreamResponse, {
      payload,
      provider,
      recordUsage,
    })
  }

  const chatBody = (await upstreamResponse.json()) as ChatCompletionResponse
  const responsesBody = translateOpenAIChatResponseToResponsesResult(
    chatBody,
    payload,
  )
  recordUsage(normalizeResponsesUsage(responsesBody.usage))

  return c.json(responsesBody)
}

const streamOpenAICompatibleProviderResponses = (
  c: Context,
  upstreamResponse: Response,
  options: {
    payload: ResponsesPayload
    provider: string
    recordUsage: (usage: UsageTokens) => void
  },
): Response => {
  logger.debug("provider.responses.openai_compatible.streaming", {
    provider: options.provider,
  })

  return streamSSE(c, async (stream) => {
    const streamState = createOpenAIChatToResponsesStreamState(options.payload)
    let usage: UsageTokens = {}
    let streamFailed = false

    try {
      for await (const chunk of events(upstreamResponse)) {
        debugJson(
          logger,
          "provider.responses.openai_compatible.stream_chunk",
          chunk,
        )

        if (!chunk.data || chunk.data === "[DONE]") {
          if (chunk.data === "[DONE]") {
            break
          }
          continue
        }

        if (chunk.event === "error") {
          const errorEvent = createResponsesStreamErrorEvent(
            chunk.data,
            streamState,
          )
          await stream.writeSSE({
            event: errorEvent.type,
            data: JSON.stringify(errorEvent),
          })
          streamFailed = true
          break
        }

        const parsedData = parseOpenAICompatibleChatStreamData(chunk.data)
        if (parsedData === null) {
          continue
        }

        // OpenAI-compatible upstreams report mid-stream failures as plain
        // `data: {"error": ...}` lines without an SSE event name
        if (isRecord(parsedData) && isRecord(parsedData.error)) {
          const errorEvent = createResponsesStreamErrorEvent(
            chunk.data,
            streamState,
          )
          await stream.writeSSE({
            event: errorEvent.type,
            data: JSON.stringify(errorEvent),
          })
          streamFailed = true
          break
        }

        if (!isChatCompletionChunk(parsedData)) {
          logger.warn(
            "provider.responses.openai_compatible.unrecognized_chunk",
            { data: chunk.data },
          )
          continue
        }

        for (const event of translateOpenAIChatStreamChunkToResponsesEvents(
          parsedData,
          streamState,
        )) {
          const nextUsage = getResponsesStreamEventUsage(event)
          if (nextUsage) {
            usage = nextUsage
          }
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          })
        }
      }

      if (!streamFailed) {
        if (streamState.responseId === undefined) {
          // Nothing usable arrived; surface an error instead of fabricating
          // a successful empty completion
          const errorEvent = createResponsesStreamErrorEvent(
            JSON.stringify({
              error: {
                message: `Empty chat completions stream from ${options.provider}`,
              },
            }),
            streamState,
          )
          await stream.writeSSE({
            event: errorEvent.type,
            data: JSON.stringify(errorEvent),
          })
        } else {
          for (const event of finalizeOpenAIChatToResponsesStream(
            streamState,
          )) {
            const nextUsage = getResponsesStreamEventUsage(event)
            if (nextUsage) {
              usage = nextUsage
            }
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event),
            })
          }
        }
      }
    } finally {
      options.recordUsage(usage)
    }
  })
}

const parseOpenAICompatibleChatStreamData = (data: string): unknown => {
  try {
    return JSON.parse(data) as unknown
  } catch (error) {
    logger.error("provider.responses.openai_compatible.parse_chunk_error", {
      data,
      error,
    })
    return null
  }
}

// Lenient on purpose: some compatible providers omit `object`/`created`
const isChatCompletionChunk = (value: unknown): value is ChatCompletionChunk =>
  isRecord(value)
  && typeof value.id === "string"
  && typeof value.model === "string"
  && Array.isArray(value.choices)

const createResponsesStreamErrorEvent = (
  data: string,
  streamState: ReturnType<typeof createOpenAIChatToResponsesStreamState>,
): ResponseStreamEvent => {
  let message = "Provider chat completion stream returned an error"
  let code: string | null = null
  let param: string | null = null
  let type: string | null = null

  try {
    const parsed = JSON.parse(data) as unknown
    const errorCandidate = isRecord(parsed) ? parsed.error : parsed
    if (isRecord(errorCandidate)) {
      message =
        typeof errorCandidate.message === "string" ?
          errorCandidate.message
        : message
      code =
        typeof errorCandidate.code === "string" ? errorCandidate.code : null
      param =
        typeof errorCandidate.param === "string" ? errorCandidate.param : null
      type =
        typeof errorCandidate.type === "string" ? errorCandidate.type : null
    }
  } catch {
    if (data.trim().length > 0) {
      message = data
    }
  }

  return {
    type: "error",
    sequence_number: ++streamState.sequenceNumber,
    code,
    message,
    param,
    error: {
      code,
      message,
      type,
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const createProviderResponsesUsageRecorder = (
  payload: ResponsesPayload,
  provider: string,
  modelConfig: ModelConfig | undefined,
  pricingCurrency: string | undefined,
): ((usage: UsageTokens) => void) => {
  const sessionAffinity =
    requestContext.getStore()?.sessionAffinity?.trim() || null

  return createProviderTokenUsageRecorder({
    endpoint: "responses",
    model: payload.model,
    pricing: modelConfig?.pricing,
    pricingCurrency,
    providerName: provider,
    sessionId: sessionAffinity ?? "",
  })
}

const streamProviderResponses = async (
  c: Context,
  upstreamResponse: ResponsesStream,
  options: {
    normalizeCodex: boolean
    provider: string
    recordUsage: (usage: UsageTokens) => void
  },
): Promise<Response> => {
  const iterator = upstreamResponse[Symbol.asyncIterator]()
  const firstResult = await iterator.next()
  if (firstResult.done) {
    throw new HTTPError(
      `Empty stream from ${options.provider} responses`,
      new Response("", { status: 502 }),
    )
  }

  const firstChunk = firstResult.value
  if (firstChunk.data && firstChunk.data !== "[DONE]") {
    const event = parseProviderResponsesStreamEvent(firstChunk.data, {
      normalizeCodex: false,
      provider: options.provider,
    })
    if (event?.type === "error") {
      const errorEvent = event
      const statusCode = errorEvent.status_code ?? 500
      return c.json(
        {
          error: {
            message: errorEvent.message,
            ...errorEvent.error,
          },
        },
        statusCode as ContentfulStatusCode,
        errorEvent.headers ?? undefined,
      )
    }
  }

  return streamSSE(c, async (stream) => {
    let usage: UsageTokens = {}

    const writeChunk = async (chunk: typeof firstChunk) => {
      debugJson(logger, "Responses stream chunk:", chunk)
      let responseChunk = chunk
      let event: ResponseStreamEvent | null = null

      if (chunk.data && chunk.data !== "[DONE]") {
        event = parseProviderResponsesStreamEvent(chunk.data, {
          normalizeCodex: options.normalizeCodex,
          provider: options.provider,
        })
        if (event && options.normalizeCodex) {
          responseChunk = {
            ...chunk,
            data: JSON.stringify(event),
            event: event.type,
          }
        }
      }

      if (event) {
        const nextUsage = getResponsesStreamEventUsage(event)
        if (nextUsage) {
          usage = nextUsage
        }
      }

      await stream.writeSSE({
        data: responseChunk.data ?? "",
        event: responseChunk.event,
      })
    }

    try {
      await writeChunk(firstChunk)

      for await (const chunk of {
        [Symbol.asyncIterator]: () => iterator,
      }) {
        await writeChunk(chunk)
      }
    } finally {
      options.recordUsage(usage)
    }
  })
}

const parseProviderResponsesStreamEvent = (
  data: string,
  options: {
    normalizeCodex: boolean
    provider: string
  },
): ResponseStreamEvent | null => {
  try {
    const parsed = JSON.parse(data) as ResponseStreamEvent
    if (options.normalizeCodex) {
      logCodexRateLimitsEvent(parsed)
    }
    return parsed
  } catch (error) {
    logger.error("provider.responses.parse_chunk_error", {
      provider: options.provider,
      data,
      error,
    })
    return null
  }
}

const getResponsesStreamEventUsage = (
  event: ResponseStreamEvent,
): UsageTokens | null => {
  if (
    event.type === "response.completed"
    || event.type === "response.failed"
    || event.type === "response.incomplete"
  ) {
    return normalizeResponsesUsage(event.response.usage)
  }

  return null
}

const getResponsesEvents = (response: Response): ResponsesStream =>
  events(response)

const isResponsesStream = (value: unknown): value is ResponsesStream => {
  return (
    Boolean(value)
    && typeof (value as ResponsesStream)[Symbol.asyncIterator] === "function"
  )
}
