import type {
  AnthropicAssistantContentBlock,
  AnthropicContentBlockDeltaEvent,
  AnthropicContentBlockStartEvent,
  AnthropicInputMessage,
  AnthropicMessageDeltaEvent,
  AnthropicMessagesPayload,
  AnthropicResponse,
  AnthropicStreamEventData,
  AnthropicTextBlock,
  AnthropicTool,
  AnthropicToolResultContentBlock,
  AnthropicToolResultBlock,
  AnthropicUserContentBlock,
} from "~/lib/types/anthropic"
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  Message,
} from "~/lib/types/chat-completions"

import {
  getTextFromOpenAIContent,
  nowSeconds,
  type OpenAIFinishReason,
  parseDataUrl,
  translateOpenAIContentPartToText,
} from "./utils"

export interface ChatStreamTranslationState {
  id?: string
  model: string
  created: number
  messageStartSent: boolean
  inputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  outputTokens: number
  toolCallIndexByBlockIndex: Map<number, number>
  nextToolCallIndex: number
}

export interface ChatStreamTranslationError {
  code?: string | null
  message: string
  param?: string | null
  type?: string | null
}

export interface ChatStreamTranslationResult {
  chunks: Array<ChatCompletionChunk>
  error?: ChatStreamTranslationError
}

const DEFAULT_MAX_TOKENS = 4096
const OPENAI_OBJECT = "chat.completion" as const
const OPENAI_CHUNK_OBJECT = "chat.completion.chunk" as const

export const createChatStreamTranslationState = (
  model: string,
): ChatStreamTranslationState => ({
  model,
  created: nowSeconds(),
  messageStartSent: false,
  inputTokens: 0,
  outputTokens: 0,
  toolCallIndexByBlockIndex: new Map(),
  nextToolCallIndex: 0,
})

export const translateOpenAIChatToAnthropicMessages = (
  payload: ChatCompletionsPayload,
): AnthropicMessagesPayload => {
  const messages: Array<AnthropicInputMessage> = []
  const systemBlocks: Array<AnthropicTextBlock> = []

  for (const message of payload.messages) {
    if (message.role === "system" || message.role === "developer") {
      const text = getTextFromOpenAIContent(message.content)
      if (text.length > 0) {
        systemBlocks.push({ type: "text", text })
      }
      continue
    }

    pushAnthropicMessage(messages, translateOpenAIMessage(message))
  }

  const maxTokens =
    payload.max_completion_tokens ?? payload.max_tokens ?? DEFAULT_MAX_TOKENS

  const anthropicPayload: AnthropicMessagesPayload = {
    model: payload.model,
    messages: messages.filter(
      (
        message,
      ): message is Exclude<AnthropicInputMessage, { role: "system" }> =>
        message.role !== "system",
    ),
    max_tokens: Math.max(1, maxTokens),
    stop_sequences: normalizeStopSequences(payload.stop),
    stream: payload.stream ?? undefined,
    temperature: payload.temperature ?? undefined,
    top_p: payload.top_p ?? undefined,
    top_k: typeof payload.top_k === "number" ? payload.top_k : undefined,
    tools: translateOpenAIToolsToAnthropic(payload.tools),
    tool_choice: translateOpenAIToolChoiceToAnthropic(payload.tool_choice),
    metadata:
      typeof payload.user === "string" ?
        {
          user_id: payload.user,
        }
      : undefined,
  }

  const reasoningEffort = normalizeReasoningEffort(payload.reasoning_effort)
  if (reasoningEffort) {
    anthropicPayload.output_config = { effort: reasoningEffort }
  }

  if (systemBlocks.length === 1) {
    anthropicPayload.system = systemBlocks[0].text
  } else if (systemBlocks.length > 1) {
    anthropicPayload.system = systemBlocks
  }

  return anthropicPayload
}

export const translateAnthropicResponseToOpenAIChat = (
  response: AnthropicResponse,
): ChatCompletionResponse => {
  const { content, reasoningText, reasoningOpaque, toolCalls } =
    collectAnthropicResponseContent(response.content)

  return {
    id: response.id,
    object: OPENAI_OBJECT,
    created: nowSeconds(),
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content.length > 0 ? content : null,
          ...(reasoningText ? { reasoning_text: reasoningText } : {}),
          ...(reasoningOpaque ? { reasoning_opaque: reasoningOpaque } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        logprobs: null,
        finish_reason: mapAnthropicStopReasonToOpenAI(response.stop_reason),
      },
    ],
    usage: translateAnthropicUsageToOpenAI(response.usage),
  }
}

export const translateAnthropicStreamEventToOpenAIChunks = (
  event: AnthropicStreamEventData,
  state: ChatStreamTranslationState,
): Array<ChatCompletionChunk> => {
  switch (event.type) {
    case "message_start": {
      state.id = event.message.id
      state.model = event.message.model
      state.inputTokens = event.message.usage.input_tokens
      state.outputTokens = event.message.usage.output_tokens
      state.cacheCreationInputTokens =
        event.message.usage.cache_creation_input_tokens
      state.cacheReadInputTokens = event.message.usage.cache_read_input_tokens
      state.messageStartSent = true
      return [
        createChatCompletionChunk(state, {
          role: "assistant",
        }),
      ]
    }
    case "content_block_start": {
      return handleAnthropicContentBlockStart(event, state)
    }
    case "content_block_delta": {
      return handleAnthropicContentBlockDelta(event, state)
    }
    case "message_delta": {
      return [handleAnthropicMessageDelta(event, state)]
    }
    case "error": {
      return []
    }
    default: {
      return []
    }
  }
}

export const translateAnthropicStreamEventToOpenAIResult = (
  event: AnthropicStreamEventData,
  state: ChatStreamTranslationState,
): ChatStreamTranslationResult => {
  if (event.type === "error") {
    return {
      chunks: [],
      error: {
        message: event.error.message,
        type: event.error.type,
      },
    }
  }

  return {
    chunks: translateAnthropicStreamEventToOpenAIChunks(event, state),
  }
}

const translateOpenAIMessage = (
  message: Message,
): Exclude<AnthropicInputMessage, { role: "system" }> => {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: translateOpenAIAssistantContent(message),
    }
  }

  if (message.role === "tool") {
    const toolResult = translateOpenAIToolMessage(message)
    return {
      role: "user",
      content:
        toolResult ? [toolResult] : getTextFromOpenAIContent(message.content),
    }
  }

  return {
    role: "user",
    content: translateOpenAIUserContent(message.content),
  }
}

const translateOpenAIUserContent = (
  content: Message["content"],
): string | Array<AnthropicUserContentBlock> => {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  const blocks = content.flatMap((part): Array<AnthropicUserContentBlock> => {
    const text = translateOpenAIContentPartToText(part)
    if (text) {
      return [{ type: "text", text }]
    }

    if (part.type === "image_url") {
      const image = parseDataUrl(part.image_url.url)
      if (image && image.mediaType.startsWith("image/")) {
        return [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: normalizeAnthropicImageMediaType(image.mediaType),
              data: image.data,
            },
          },
        ]
      }
    }

    if (part.type === "file") {
      const file = parseDataUrl(part.file.file_data)
      if (file?.mediaType === "application/pdf") {
        return [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: file.data,
            },
            title: part.file.filename,
          },
        ]
      }
    }

    return []
  })

  return blocks.length > 0 ? blocks : ""
}

const translateOpenAIAssistantContent = (
  message: Message,
): string | Array<AnthropicAssistantContentBlock> => {
  const blocks: Array<AnthropicAssistantContentBlock> = []
  const reasoningText = message.reasoning_text ?? message.reasoning_content
  if (reasoningText || message.reasoning_opaque) {
    blocks.push({
      type: "thinking",
      thinking: reasoningText ?? "",
      signature: message.reasoning_opaque ?? "",
    })
  }

  const text = getTextFromOpenAIContent(message.content)
  if (text.length > 0) {
    blocks.push({ type: "text", text })
  }

  for (const toolCall of message.tool_calls ?? []) {
    blocks.push({
      type: "tool_use",
      id: toolCall.id,
      name: toolCall.function.name,
      input: parseToolArguments(toolCall.function.arguments),
    })
  }

  if (blocks.length === 0) {
    return ""
  }

  return blocks.length === 1 && blocks[0].type === "text" ?
      blocks[0].text
    : blocks
}

const translateOpenAIToolMessage = (
  message: Message,
): AnthropicToolResultBlock | null => {
  if (!message.tool_call_id) {
    return null
  }

  return {
    type: "tool_result",
    tool_use_id: message.tool_call_id,
    content: translateOpenAIContentToToolResultContent(message.content),
  }
}

const translateOpenAIContentToToolResultContent = (
  content: Message["content"],
): string | Array<AnthropicToolResultContentBlock> => {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  const blocks = content.flatMap(
    (part): Array<AnthropicToolResultContentBlock> => {
      const text = translateOpenAIContentPartToText(part)
      if (text) {
        return [{ type: "text", text }]
      }

      if (part.type === "image_url") {
        const image = parseDataUrl(part.image_url.url)
        if (image && image.mediaType.startsWith("image/")) {
          return [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: normalizeAnthropicImageMediaType(image.mediaType),
                data: image.data,
              },
            },
          ]
        }
      }

      if (part.type === "file") {
        const file = parseDataUrl(part.file.file_data)
        if (file?.mediaType === "application/pdf") {
          return [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: file.data,
              },
              title: part.file.filename,
            },
          ]
        }
      }

      return []
    },
  )

  return blocks.length > 0 ? blocks : ""
}

const pushAnthropicMessage = (
  messages: Array<AnthropicInputMessage>,
  next: Exclude<AnthropicInputMessage, { role: "system" }>,
): void => {
  const previous = messages.at(-1)
  if (!previous || previous.role !== next.role) {
    messages.push(next)
    return
  }

  if (previous.role === "user" && next.role === "user") {
    previous.content = mergeUserAnthropicContent(previous.content, next.content)
    return
  }

  if (previous.role === "assistant" && next.role === "assistant") {
    previous.content = mergeAssistantAnthropicContent(
      previous.content,
      next.content,
    )
  }
}

const mergeUserAnthropicContent = (
  left: string | Array<AnthropicUserContentBlock>,
  right: string | Array<AnthropicUserContentBlock>,
): Array<AnthropicUserContentBlock> => {
  const leftBlocks = normalizeUserAnthropicContentToBlocks(left)
  const rightBlocks = normalizeUserAnthropicContentToBlocks(right)
  return [...leftBlocks, ...rightBlocks]
}

const mergeAssistantAnthropicContent = (
  left: string | Array<AnthropicAssistantContentBlock>,
  right: string | Array<AnthropicAssistantContentBlock>,
): Array<AnthropicAssistantContentBlock> => {
  const leftBlocks = normalizeAssistantAnthropicContentToBlocks(left)
  const rightBlocks = normalizeAssistantAnthropicContentToBlocks(right)
  return [...leftBlocks, ...rightBlocks]
}

const normalizeUserAnthropicContentToBlocks = (
  content: string | Array<AnthropicUserContentBlock>,
): Array<AnthropicUserContentBlock> => {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : []
  }

  return content
}

const normalizeAssistantAnthropicContentToBlocks = (
  content: string | Array<AnthropicAssistantContentBlock>,
): Array<AnthropicAssistantContentBlock> => {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : []
  }

  return content
}

const translateOpenAIToolsToAnthropic = (
  tools: ChatCompletionsPayload["tools"],
): Array<AnthropicTool> | undefined => {
  if (!tools || tools.length === 0) {
    return undefined
  }

  return tools.flatMap((tool): Array<AnthropicTool> => {
    if (tool.type !== "function") {
      return []
    }

    return [
      {
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters ?? {},
      },
    ]
  })
}

const translateOpenAIToolChoiceToAnthropic = (
  toolChoice: ChatCompletionsPayload["tool_choice"],
): AnthropicMessagesPayload["tool_choice"] => {
  if (!toolChoice) {
    return undefined
  }

  if (toolChoice === "auto") {
    return { type: "auto" }
  }

  if (toolChoice === "none") {
    return { type: "none" }
  }

  if (toolChoice === "required") {
    return { type: "any" }
  }

  return {
    type: "tool",
    name: toolChoice.function.name,
  }
}

const collectAnthropicResponseContent = (
  blocks: AnthropicResponse["content"],
): {
  content: string
  reasoningText?: string
  reasoningOpaque?: string
  toolCalls: Array<{
    id: string
    type: "function"
    function: {
      name: string
      arguments: string
    }
  }>
} => {
  const text: Array<string> = []
  const reasoningText: Array<string> = []
  let reasoningOpaque: string | undefined
  const toolCalls: Array<{
    id: string
    type: "function"
    function: {
      name: string
      arguments: string
    }
  }> = []

  for (const block of blocks) {
    switch (block.type) {
      case "text": {
        text.push(block.text)
        break
      }
      case "thinking": {
        if (block.thinking.length > 0) {
          reasoningText.push(block.thinking)
        }
        if (block.signature.length > 0) {
          reasoningOpaque = block.signature
        }
        break
      }
      case "tool_use": {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        })
        break
      }
      default: {
        break
      }
    }
  }

  return {
    content: text.join(""),
    reasoningText:
      reasoningText.length > 0 ? reasoningText.join("\n\n") : undefined,
    reasoningOpaque,
    toolCalls,
  }
}

const handleAnthropicContentBlockStart = (
  event: AnthropicContentBlockStartEvent,
  state: ChatStreamTranslationState,
): Array<ChatCompletionChunk> => {
  if (event.content_block.type === "tool_use") {
    const toolCallIndex = state.nextToolCallIndex++
    state.toolCallIndexByBlockIndex.set(event.index, toolCallIndex)
    return [
      createChatCompletionChunk(state, {
        tool_calls: [
          {
            index: toolCallIndex,
            id: event.content_block.id,
            type: "function",
            function: {
              name: event.content_block.name,
              arguments: "",
            },
          },
        ],
      }),
    ]
  }

  if (
    event.content_block.type === "text"
    && event.content_block.text.length > 0
  ) {
    return [
      createChatCompletionChunk(state, {
        content: event.content_block.text,
      }),
    ]
  }

  if (
    event.content_block.type === "thinking"
    && event.content_block.thinking.length > 0
  ) {
    return [
      createChatCompletionChunk(state, {
        reasoning_text: event.content_block.thinking,
      }),
    ]
  }

  return []
}

const handleAnthropicContentBlockDelta = (
  event: AnthropicContentBlockDeltaEvent,
  state: ChatStreamTranslationState,
): Array<ChatCompletionChunk> => {
  switch (event.delta.type) {
    case "text_delta": {
      return [
        createChatCompletionChunk(state, {
          content: event.delta.text,
        }),
      ]
    }
    case "thinking_delta": {
      return [
        createChatCompletionChunk(state, {
          reasoning_text: event.delta.thinking,
        }),
      ]
    }
    case "signature_delta": {
      return event.delta.signature.length > 0 ?
          [
            createChatCompletionChunk(state, {
              reasoning_opaque: event.delta.signature,
            }),
          ]
        : []
    }
    case "input_json_delta": {
      const toolCallIndex = state.toolCallIndexByBlockIndex.get(event.index)
      if (toolCallIndex === undefined) {
        return []
      }
      return [
        createChatCompletionChunk(state, {
          tool_calls: [
            {
              index: toolCallIndex,
              function: {
                arguments: event.delta.partial_json,
              },
            },
          ],
        }),
      ]
    }
  }
}

const handleAnthropicMessageDelta = (
  event: AnthropicMessageDeltaEvent,
  state: ChatStreamTranslationState,
): ChatCompletionChunk => {
  if (event.usage) {
    // Streams translated from Responses only learn input tokens here, not
    // in message_start
    state.inputTokens = event.usage.input_tokens ?? state.inputTokens
    state.outputTokens = event.usage.output_tokens
    state.cacheCreationInputTokens =
      event.usage.cache_creation_input_tokens ?? state.cacheCreationInputTokens
    state.cacheReadInputTokens =
      event.usage.cache_read_input_tokens ?? state.cacheReadInputTokens
  }

  // A message_delta without stop_reason (e.g. a usage-only update) must not
  // end the choice; a non-null finish_reason makes OpenAI clients stop reading
  const stopReason = event.delta.stop_reason ?? null
  return createChatCompletionChunk(
    state,
    {},
    stopReason ? mapAnthropicStopReasonToOpenAI(stopReason) : null,
    translateStreamStateUsage(state),
  )
}

const createChatCompletionChunk = (
  state: ChatStreamTranslationState,
  delta: ChatCompletionChunk["choices"][number]["delta"],
  finishReason: OpenAIFinishReason = null,
  usage?: ChatCompletionChunk["usage"],
): ChatCompletionChunk => ({
  id: state.id ?? `chatcmpl-${state.created}`,
  object: OPENAI_CHUNK_OBJECT,
  created: state.created,
  model: state.model,
  choices: [
    {
      index: 0,
      delta,
      finish_reason: finishReason,
      logprobs: null,
    },
  ],
  ...(usage ? { usage } : {}),
})

const translateStreamStateUsage = (
  state: ChatStreamTranslationState,
): ChatCompletionChunk["usage"] => {
  const promptTokens = getPromptTokens({
    inputTokens: state.inputTokens,
    cacheCreationInputTokens: state.cacheCreationInputTokens,
    cacheReadInputTokens: state.cacheReadInputTokens,
  })
  return {
    prompt_tokens: promptTokens,
    completion_tokens: state.outputTokens,
    total_tokens: promptTokens + state.outputTokens,
    prompt_tokens_details: {
      cache_creation_input_tokens: state.cacheCreationInputTokens ?? 0,
      cached_tokens: state.cacheReadInputTokens ?? 0,
    },
  }
}

const translateAnthropicUsageToOpenAI = (
  usage: AnthropicResponse["usage"],
): ChatCompletionResponse["usage"] => {
  const promptTokens = getPromptTokens({
    inputTokens: usage.input_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens,
  })
  return {
    prompt_tokens: promptTokens,
    completion_tokens: usage.output_tokens,
    total_tokens: promptTokens + usage.output_tokens,
    prompt_tokens_details: {
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cached_tokens: usage.cache_read_input_tokens ?? 0,
    },
  }
}

const getPromptTokens = (usage: {
  inputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}): number =>
  usage.inputTokens
  + (usage.cacheCreationInputTokens ?? 0)
  + (usage.cacheReadInputTokens ?? 0)

const mapAnthropicStopReasonToOpenAI = (
  stopReason: AnthropicResponse["stop_reason"],
): Exclude<OpenAIFinishReason, null> => {
  switch (stopReason) {
    case "max_tokens": {
      return "length"
    }
    case "tool_use": {
      return "tool_calls"
    }
    case "refusal": {
      return "content_filter"
    }
    default: {
      return "stop"
    }
  }
}

const normalizeStopSequences = (
  stop: ChatCompletionsPayload["stop"],
): Array<string> | undefined => {
  if (typeof stop === "string") {
    return [stop]
  }

  return Array.isArray(stop) ? stop : undefined
}

const normalizeReasoningEffort = (
  effort: ChatCompletionsPayload["reasoning_effort"],
):
  | NonNullable<AnthropicMessagesPayload["output_config"]>["effort"]
  | undefined => {
  if (
    effort === "low"
    || effort === "medium"
    || effort === "high"
    || effort === "xhigh"
    || effort === "max"
  ) {
    return effort
  }

  return undefined
}

const parseToolArguments = (raw: string): Record<string, unknown> => {
  if (!raw.trim()) {
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ?
        (parsed as Record<string, unknown>)
      : { arguments: parsed }
  } catch {
    return { raw_arguments: raw }
  }
}

const normalizeAnthropicImageMediaType = (
  mediaType: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" => {
  if (
    mediaType === "image/jpeg"
    || mediaType === "image/png"
    || mediaType === "image/gif"
    || mediaType === "image/webp"
  ) {
    return mediaType
  }

  return "image/png"
}
