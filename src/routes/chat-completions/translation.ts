import {
  createResponsesStreamState,
  translateResponsesStreamEvent,
  type ResponsesStreamState,
} from "~/routes/messages/responses-stream-translation"
import { translateResponsesResultToAnthropic } from "~/routes/messages/responses-translation"
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
} from "~/routes/messages/anthropic-types"
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Message,
} from "~/services/copilot/create-chat-completions"
import type {
  FunctionTool,
  ResponseFunctionCallOutputItem,
  ResponseInputContent,
  ResponseInputItem,
  ResponseInputMessage,
  ResponseInputReasoning,
  ResponseFunctionToolCallItem,
  ResponseOutputFunctionCall,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseUsage,
  ResponsesPayload,
  ResponsesResult,
  ResponseStreamEvent,
  Tool as ResponsesTool,
  ToolChoiceFunction,
  ToolChoiceOptions,
} from "~/services/copilot/create-responses"

type OpenAIFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | null

interface ChatStreamTranslationState {
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

export class ResponsesToOpenAIChatTranslationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ResponsesToOpenAIChatTranslationError"
  }
}

export interface OpenAIChatToResponsesStreamState {
  payload: ResponsesPayload
  responseId?: string
  createdAt?: number
  model: string
  sequenceNumber: number
  nextOutputIndex: number
  outputItemsByIndex: Map<number, ResponseOutputItem>
  messageOutputIndex?: number
  messageItemId?: string
  messageText: string
  messageDone: boolean
  toolCallsByChatIndex: Map<number, OpenAIChatToolCallStreamState>
  usage: ResponseUsage | null
  finishReason: OpenAIFinishReason
  completed: boolean
}

interface OpenAIChatToolCallStreamState {
  outputIndex: number
  itemId: string
  callId: string
  name: string
  arguments: string
  done: boolean
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

export const translateOpenAIChatToResponsesPayload = (
  payload: ChatCompletionsPayload,
): ResponsesPayload => {
  const input: Array<ResponseInputItem> = []
  const instructions: Array<string> = []

  for (const message of payload.messages) {
    switch (message.role) {
      case "system":
      case "developer": {
        const text = getTextFromOpenAIContent(message.content)
        if (text.length > 0) {
          instructions.push(text)
        }
        break
      }
      case "user": {
        input.push(createResponsesMessage("user", message.content))
        break
      }
      case "assistant": {
        const assistantContent = mapOpenAIContentToResponsesContent(
          message.content,
          "assistant",
        )
        if (hasResponsesContent(assistantContent)) {
          input.push({
            type: "message",
            role: "assistant",
            content: assistantContent,
          })
        }

        for (const toolCall of message.tool_calls ?? []) {
          input.push({
            type: "function_call",
            call_id: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
            status: "completed",
          })
        }
        break
      }
      case "tool": {
        if (message.tool_call_id) {
          input.push({
            type: "function_call_output",
            call_id: message.tool_call_id,
            output: mapOpenAIContentToResponsesContent(message.content, "user"),
            status: "completed",
          })
        } else {
          input.push(createResponsesMessage("user", message.content))
        }
        break
      }
      default: {
        break
      }
    }
  }

  const maxOutputTokens = payload.max_completion_tokens ?? payload.max_tokens
  const reasoningEffort = normalizeResponsesReasoningEffort(
    payload.reasoning_effort,
  )

  return {
    model: payload.model,
    input,
    instructions: instructions.length > 0 ? instructions.join("\n\n") : null,
    tools: translateOpenAIToolsToResponses(payload.tools),
    tool_choice: translateOpenAIToolChoiceToResponses(payload.tool_choice),
    temperature: payload.temperature ?? null,
    top_p: payload.top_p ?? null,
    max_output_tokens: maxOutputTokens ?? null,
    metadata:
      typeof payload.user === "string" ?
        {
          user: payload.user,
        }
      : null,
    stream: payload.stream ?? null,
    store: false,
    parallel_tool_calls: payload.parallel_tool_calls ?? true,
    ...(reasoningEffort ?
      {
        reasoning: {
          effort: reasoningEffort,
          summary: "auto",
        },
      }
    : {}),
  }
}

export const translateResponsesPayloadToOpenAIChat = (
  payload: ResponsesPayload,
): ChatCompletionsPayload => {
  const messages = translateResponsesInputToOpenAIChatMessages(payload)
  const tools = translateResponsesToolsToOpenAI(payload.tools)
  const toolChoice = translateResponsesToolChoiceToOpenAI(payload.tool_choice)
  const maxTokens = payload.max_output_tokens ?? undefined
  const reasoningEffort = normalizeResponsesEffortForOpenAIChat(
    payload.reasoning?.effort,
  )
  const chatPayload: ChatCompletionsPayload = {
    model: payload.model,
    messages,
    stream: payload.stream ?? undefined,
    temperature: payload.temperature ?? undefined,
    top_p: payload.top_p ?? undefined,
    max_tokens: maxTokens,
    tools,
    tool_choice: toolChoice,
    reasoning_effort: reasoningEffort,
  }

  if (payload.parallel_tool_calls !== undefined && tools?.length) {
    chatPayload.parallel_tool_calls = payload.parallel_tool_calls
  }

  return pruneUndefinedChatPayload(chatPayload)
}

export const translateOpenAIChatResponseToResponsesResult = (
  response: ChatCompletionResponse,
  sourcePayload: ResponsesPayload,
): ResponsesResult => {
  const firstChoice = response.choices[0]
  const output =
    firstChoice ?
      translateOpenAIChatChoiceToResponsesOutput(firstChoice, response.id)
    : []
  const finishReason = firstChoice?.finish_reason ?? "stop"

  return createResponsesResult({
    createdAt: response.created,
    finishReason,
    id: toResponsesId(response.id),
    model: response.model,
    output,
    sourcePayload,
    usage: translateOpenAIUsageToResponses(response.usage),
  })
}

export const createOpenAIChatToResponsesStreamState = (
  payload: ResponsesPayload,
): OpenAIChatToResponsesStreamState => ({
  payload,
  model: payload.model,
  sequenceNumber: 0,
  nextOutputIndex: 0,
  outputItemsByIndex: new Map(),
  messageText: "",
  messageDone: false,
  toolCallsByChatIndex: new Map(),
  usage: null,
  finishReason: null,
  completed: false,
})

export const translateOpenAIChatStreamChunkToResponsesEvents = (
  chunk: ChatCompletionChunk,
  state: OpenAIChatToResponsesStreamState,
): Array<ResponseStreamEvent> => {
  const responseEvents: Array<ResponseStreamEvent> = []
  ensureOpenAIChatResponseStarted(chunk, state, responseEvents)

  if (chunk.usage) {
    state.usage = translateOpenAIUsageToResponses(chunk.usage)
  }

  for (const choice of chunk.choices) {
    const delta = choice.delta

    if (delta.role === "assistant" || delta.content !== undefined) {
      ensureOpenAIChatMessageOutputItem(state, responseEvents)
    }

    if (delta.content) {
      ensureOpenAIChatMessageOutputItem(state, responseEvents)
      state.messageText += delta.content
      responseEvents.push({
        type: "response.output_text.delta",
        sequence_number: nextResponsesSequenceNumber(state),
        output_index: state.messageOutputIndex ?? 0,
        content_index: 0,
        item_id: state.messageItemId ?? createResponseMessageItemId(state),
        delta: delta.content,
      })
    }

    for (const toolCallDelta of delta.tool_calls ?? []) {
      responseEvents.push(
        ...translateOpenAIChatToolCallDeltaToResponsesEvents(
          toolCallDelta,
          state,
        ),
      )
    }

    if (choice.finish_reason) {
      state.finishReason = choice.finish_reason
      responseEvents.push(...closeOpenAIChatResponseOutputItems(state))
    }
  }

  return responseEvents
}

export const finalizeOpenAIChatToResponsesStream = (
  state: OpenAIChatToResponsesStreamState,
): Array<ResponseStreamEvent> => {
  if (state.completed) {
    return []
  }

  const responseEvents = closeOpenAIChatResponseOutputItems(state)
  const response = createResponsesResult({
    createdAt: state.createdAt ?? nowSeconds(),
    finishReason: state.finishReason ?? "stop",
    id: state.responseId ?? toResponsesId(`chatcmpl-${nowSeconds()}`),
    model: state.model,
    output: getOrderedResponsesOutputItems(state),
    sourcePayload: state.payload,
    usage: state.usage,
  })
  const terminalType =
    response.status === "incomplete" ?
      "response.incomplete"
    : "response.completed"

  responseEvents.push({
    type: terminalType,
    sequence_number: nextResponsesSequenceNumber(state),
    response,
  } as ResponseStreamEvent)
  state.completed = true

  return responseEvents
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

export const translateResponsesResultToOpenAIChat = (
  response: ResponsesResult,
): ChatCompletionResponse =>
  translateAnthropicResponseToOpenAIChat(
    translateResponsesResultToAnthropic(response),
  )

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

export const translateResponsesStreamEventToOpenAIChunks = (
  event: ResponseStreamEvent,
  responsesState: ResponsesStreamState,
  chatState: ChatStreamTranslationState,
): Array<ChatCompletionChunk> =>
  translateResponsesStreamEvent(event, responsesState).flatMap(
    (anthropicEvent) =>
      translateAnthropicStreamEventToOpenAIChunks(anthropicEvent, chatState),
  )

export const translateResponsesStreamEventToOpenAIResult = (
  event: ResponseStreamEvent,
  responsesState: ResponsesStreamState,
  chatState: ChatStreamTranslationState,
): ChatStreamTranslationResult => {
  const chunks: Array<ChatCompletionChunk> = []

  for (const anthropicEvent of translateResponsesStreamEvent(
    event,
    responsesState,
  )) {
    const translated = translateAnthropicStreamEventToOpenAIResult(
      anthropicEvent,
      chatState,
    )
    chunks.push(...translated.chunks)
    if (translated.error) {
      return {
        chunks,
        error: translated.error,
      }
    }
  }

  return { chunks }
}

export const createResponsesToChatStreamStates = (model: string) => ({
  responsesState: createResponsesStreamState(),
  chatState: createChatStreamTranslationState(model),
})

type ChatMessageRole = Message["role"]
type ChatToolCall = NonNullable<Message["tool_calls"]>[number]
type ChatChoice = ChatCompletionResponse["choices"][number]
type ChatToolCallDelta = NonNullable<
  ChatCompletionChunk["choices"][number]["delta"]["tool_calls"]
>[number]

const translateResponsesInputToOpenAIChatMessages = (
  payload: ResponsesPayload,
): Array<Message> => {
  const messages: Array<Message> = []

  if (payload.instructions) {
    messages.push({
      role: "system",
      content: payload.instructions,
    })
  }

  if (typeof payload.input === "string") {
    messages.push({ role: "user", content: payload.input })
    return messages
  }

  if (!Array.isArray(payload.input)) {
    return messages
  }

  for (const item of payload.input) {
    translateResponsesInputItemToOpenAIChatMessages(item, messages)
  }

  repairOpenAIChatToolMessageOrder(messages)
  return messages
}

const translateResponsesInputItemToOpenAIChatMessages = (
  item: ResponseInputItem,
  messages: Array<Message>,
): void => {
  if (isResponsesInputMessage(item)) {
    const role = normalizeResponsesMessageRoleForOpenAIChat(item.role)
    messages.push({
      role,
      content: translateResponsesInputContentToOpenAIChatContent(item.content),
    })
    return
  }

  if (isResponsesFunctionToolCallInput(item)) {
    pushResponsesFunctionCallAsOpenAIChatToolCall(item, messages)
    return
  }

  if (isResponsesFunctionCallOutputInput(item)) {
    messages.push({
      role: "tool",
      tool_call_id: item.call_id,
      content: translateResponsesToolOutputToOpenAIChatContent(item.output),
    })
    return
  }

  if (isResponsesInputReasoning(item)) {
    mergeResponsesReasoningIntoLastAssistantMessage(item, messages)
    return
  }

  if (
    isRecord(item)
    && (item.type === "compaction" || item.type === "compaction_trigger")
  ) {
    return
  }

  if (
    isRecord(item)
    && (item.type === "tool_search_call" || item.type === "tool_search_output")
  ) {
    throw new ResponsesToOpenAIChatTranslationError(
      `Responses input item type '${item.type}' cannot be represented by OpenAI Chat Completions`,
    )
  }
}

const isResponsesInputMessage = (
  item: ResponseInputItem,
): item is ResponseInputMessage =>
  isRecord(item) && item.type === "message" && typeof item.role === "string"

const isResponsesFunctionToolCallInput = (
  item: ResponseInputItem,
): item is ResponseFunctionToolCallItem =>
  isRecord(item)
  && item.type === "function_call"
  && typeof item.call_id === "string"
  && typeof item.name === "string"
  && typeof item.arguments === "string"

const isResponsesFunctionCallOutputInput = (
  item: ResponseInputItem,
): item is ResponseFunctionCallOutputItem =>
  isRecord(item)
  && item.type === "function_call_output"
  && typeof item.call_id === "string"

const isResponsesInputReasoning = (
  item: ResponseInputItem,
): item is ResponseInputReasoning =>
  isRecord(item) && item.type === "reasoning" && Array.isArray(item.summary)

const normalizeResponsesMessageRoleForOpenAIChat = (
  role: unknown,
): ChatMessageRole => {
  if (role === "assistant" || role === "system" || role === "tool") {
    return role
  }

  if (role === "developer") {
    return "system"
  }

  return "user"
}

const translateResponsesInputContentToOpenAIChatContent = (
  content: ResponseInputMessage["content"],
): Message["content"] => {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  const parts: Array<ContentPart> = []
  const text: Array<string> = []

  for (const block of content) {
    if (!isRecord(block)) {
      continue
    }

    if (
      (block.type === "input_text" || block.type === "output_text")
      && typeof block.text === "string"
    ) {
      text.push(block.text)
      parts.push({ type: "text", text: block.text })
      continue
    }

    if (block.type === "input_image" && typeof block.image_url === "string") {
      parts.push({
        type: "image_url",
        image_url: {
          url: block.image_url,
          detail: normalizeOpenAIImageDetail(block.detail),
        },
      })
      continue
    }

    if (block.type === "input_file" && typeof block.file_data === "string") {
      parts.push({
        type: "file",
        file: {
          file_data: block.file_data,
          ...(typeof block.filename === "string" ?
            { filename: block.filename }
          : {}),
        },
      })
    }
  }

  if (parts.length === text.length) {
    return text.join("\n")
  }

  return parts
}

const normalizeOpenAIImageDetail = (
  value: unknown,
): "low" | "high" | "auto" => {
  if (value === "low" || value === "high" || value === "auto") {
    return value
  }

  return "auto"
}

const translateResponsesToolOutputToOpenAIChatContent = (
  output: ResponseFunctionCallOutputItemOutput,
): Message["content"] => {
  if (typeof output === "string") {
    return output
  }

  return translateResponsesInputContentToOpenAIChatContent(output)
}

type ResponseFunctionCallOutputItemOutput =
  ResponseFunctionCallOutputItem["output"]

const pushResponsesFunctionCallAsOpenAIChatToolCall = (
  item: ResponseFunctionToolCallLike,
  messages: Array<Message>,
): void => {
  const toolCall: ChatToolCall = {
    id: item.call_id,
    type: "function",
    function: {
      name: resolveResponsesFunctionCallName(item),
      arguments: item.arguments,
    },
  }

  const lastMessage = messages.at(-1)
  if (lastMessage?.role === "assistant") {
    lastMessage.tool_calls = [...(lastMessage.tool_calls ?? []), toolCall]
    lastMessage.content ??= null
    return
  }

  messages.push({
    role: "assistant",
    content: null,
    tool_calls: [toolCall],
  })
}

type ResponseFunctionToolCallLike = Extract<
  ResponseInputItem,
  { type: "function_call" }
>

const resolveResponsesFunctionCallName = (
  item: ResponseFunctionToolCallLike,
): string => {
  const namespace = (item as { namespace?: unknown }).namespace
  if (typeof namespace === "string" && namespace.trim().length > 0) {
    return namespace
  }

  return item.name
}

const mergeResponsesReasoningIntoLastAssistantMessage = (
  item: Extract<ResponseInputItem, { type: "reasoning" }>,
  messages: Array<Message>,
): void => {
  const text = item.summary
    .flatMap((block) =>
      block.type === "summary_text" && block.text ? [block.text] : [],
    )
    .join("\n\n")
  const encryptedContent =
    typeof item.encrypted_content === "string" ? item.encrypted_content : null

  if (!text && !encryptedContent) {
    return
  }

  let assistantMessage = messages.at(-1)
  if (assistantMessage?.role !== "assistant") {
    assistantMessage = {
      role: "assistant",
      content: null,
    }
    messages.push(assistantMessage)
  }

  if (text) {
    assistantMessage.reasoning_content = [
      assistantMessage.reasoning_content,
      text,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n\n")
  }

  if (encryptedContent) {
    assistantMessage.reasoning_opaque = encryptedContent
  }
}

const repairOpenAIChatToolMessageOrder = (messages: Array<Message>): void => {
  let index = 0
  while (index < messages.length) {
    const message = messages[index]
    const expectedToolCallIds = new Set(
      message.role === "assistant" ?
        (message.tool_calls?.map((toolCall) => toolCall.id) ?? [])
      : [],
    )

    if (expectedToolCallIds.size === 0) {
      index += 1
      continue
    }

    const displacedMessages: Array<Message> = []
    let scanIndex = index + 1
    while (scanIndex < messages.length && expectedToolCallIds.size > 0) {
      const candidate = messages[scanIndex]
      if (
        candidate.role === "tool"
        && candidate.tool_call_id
        && expectedToolCallIds.has(candidate.tool_call_id)
      ) {
        expectedToolCallIds.delete(candidate.tool_call_id)
        scanIndex += 1
        continue
      }

      if (candidate.role === "tool") {
        break
      }

      displacedMessages.push(candidate)
      messages.splice(scanIndex, 1)
    }

    if (displacedMessages.length > 0) {
      messages.splice(index, 0, ...displacedMessages)
      index += displacedMessages.length + 1
      continue
    }

    index += 1
  }
}

const translateResponsesToolsToOpenAI = (
  tools: ResponsesPayload["tools"],
): ChatCompletionsPayload["tools"] => {
  if (!tools || tools.length === 0) {
    return undefined
  }

  return tools.flatMap((tool) => {
    if (!isRecord(tool)) {
      throw new ResponsesToOpenAIChatTranslationError(
        "Responses tool cannot be represented by OpenAI Chat Completions",
      )
    }

    if (tool.type === "namespace") {
      return translateResponsesNamespaceToolToOpenAI(tool)
    }

    if (tool.type === "web_search" || tool.type === "web_search_preview") {
      return []
    }

    if (tool.type !== "function") {
      throw new ResponsesToOpenAIChatTranslationError(
        `Responses tool type '${String(tool.type)}' cannot be represented by OpenAI Chat Completions`,
      )
    }

    return [translateResponsesFunctionToolToOpenAI(tool)]
  })
}

const translateResponsesNamespaceToolToOpenAI = (
  tool: Record<string, unknown>,
): NonNullable<ChatCompletionsPayload["tools"]> => {
  if (typeof tool.name !== "string" || !Array.isArray(tool.tools)) {
    throw new ResponsesToOpenAIChatTranslationError(
      "Responses namespace tool is missing a name or tools",
    )
  }
  const namespace = tool.name

  return tool.tools.map((innerTool) => {
    if (!isRecord(innerTool) || innerTool.type !== "function") {
      throw new ResponsesToOpenAIChatTranslationError(
        `Responses namespace tool '${namespace}' contains a non-function tool`,
      )
    }

    return translateResponsesFunctionToolToOpenAI(innerTool, {
      namespace,
    })
  })
}

const translateResponsesFunctionToolToOpenAI = (
  tool: Record<string, unknown>,
  options?: { namespace?: string },
): NonNullable<ChatCompletionsPayload["tools"]>[number] => {
  if (typeof tool.name !== "string") {
    throw new ResponsesToOpenAIChatTranslationError(
      "Responses function tool is missing a name",
    )
  }

  return {
    type: "function",
    function: {
      name: normalizeOpenAIChatFunctionName(tool.name, options?.namespace),
      ...(typeof tool.description === "string" ?
        { description: tool.description }
      : {}),
      parameters:
        isRecord(tool.parameters) ?
          tool.parameters
        : { type: "object", properties: {} },
    },
  }
}

const normalizeOpenAIChatFunctionName = (
  name: string,
  namespace?: string,
): string => {
  if (!namespace || namespace === name) {
    return name
  }

  const candidate = `${namespace}__${name}`.replaceAll(/[^a-zA-Z0-9_-]/gu, "_")
  return candidate.slice(0, 64)
}

const translateResponsesToolChoiceToOpenAI = (
  toolChoice: ResponsesPayload["tool_choice"],
): ChatCompletionsPayload["tool_choice"] | undefined => {
  if (
    toolChoice === "auto"
    || toolChoice === "none"
    || toolChoice === "required"
  ) {
    return toolChoice
  }

  if (
    isRecord(toolChoice)
    && toolChoice.type === "function"
    && typeof toolChoice.name === "string"
  ) {
    return {
      type: "function",
      function: {
        name: toolChoice.name,
      },
    }
  }

  return undefined
}

const pruneUndefinedChatPayload = (
  payload: ChatCompletionsPayload,
): ChatCompletionsPayload => {
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) {
      delete payload[key]
    }
  }
  return payload
}

const translateOpenAIChatChoiceToResponsesOutput = (
  choice: ChatChoice,
  responseId: string,
): Array<ResponseOutputItem> => {
  const output: Array<ResponseOutputItem> = []
  const baseId = toResponsesId(responseId)
  const message = choice.message
  const reasoningText = message.reasoning_text ?? message.reasoning_content

  if (reasoningText || message.reasoning_opaque) {
    output.push({
      id: `${baseId}_reasoning`,
      type: "reasoning",
      status: "completed",
      ...(reasoningText ?
        {
          summary: [
            {
              type: "summary_text",
              text: reasoningText,
            },
          ],
        }
      : {}),
      ...(message.reasoning_opaque ?
        { encrypted_content: message.reasoning_opaque }
      : {}),
    })
  }

  const content = message.content ?? ""
  if (content.length > 0) {
    output.push({
      id: `${baseId}_msg`,
      type: "message",
      role: "assistant",
      status: choice.finish_reason === "length" ? "incomplete" : "completed",
      content: [
        {
          type: "output_text",
          text: content,
          annotations: [],
        },
      ],
    })
  }

  for (const toolCall of message.tool_calls ?? []) {
    output.push({
      type: "function_call",
      call_id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
      status: "completed",
    })
  }

  return output
}

const createResponsesResult = ({
  createdAt,
  finishReason,
  id,
  model,
  output,
  sourcePayload,
  usage,
}: {
  createdAt: number
  finishReason: OpenAIFinishReason
  id: string
  model: string
  output: Array<ResponseOutputItem>
  sourcePayload: ResponsesPayload
  usage: ResponseUsage | null
}): ResponsesResult => {
  const incompleteReason =
    finishReason === "length" ? "max_output_tokens"
    : finishReason === "content_filter" ? "content_filter"
    : null

  return {
    id,
    object: "response",
    created_at: createdAt,
    model,
    output,
    output_text: collectResponsesOutputText(output),
    status: incompleteReason ? "incomplete" : "completed",
    usage,
    error: null,
    incomplete_details: incompleteReason ? { reason: incompleteReason } : null,
    instructions: sourcePayload.instructions ?? null,
    metadata: sourcePayload.metadata ?? null,
    parallel_tool_calls: sourcePayload.parallel_tool_calls ?? true,
    temperature: sourcePayload.temperature ?? null,
    tool_choice: sourcePayload.tool_choice ?? "auto",
    tools: sourcePayload.tools ?? [],
    top_p: sourcePayload.top_p ?? null,
  }
}

const collectResponsesOutputText = (
  output: Array<ResponseOutputItem>,
): string => {
  let text = ""
  for (const item of output) {
    if (item.type !== "message") {
      continue
    }

    for (const block of item.content ?? []) {
      if (
        isRecord(block)
        && block.type === "output_text"
        && typeof block.text === "string"
      ) {
        text += block.text
      }
    }
  }
  return text
}

const translateOpenAIUsageToResponses = (
  usage: ChatCompletionResponse["usage"] | ChatCompletionChunk["usage"],
): ResponseUsage | null => {
  if (!usage) {
    return null
  }

  const cachedTokens =
    usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens

  return {
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    ...(cachedTokens !== undefined ?
      {
        input_tokens_details: {
          cached_tokens: cachedTokens,
        },
      }
    : {}),
  }
}

const ensureOpenAIChatResponseStarted = (
  chunk: ChatCompletionChunk,
  state: OpenAIChatToResponsesStreamState,
  events: Array<ResponseStreamEvent>,
): void => {
  if (state.responseId) {
    return
  }

  state.responseId = toResponsesId(chunk.id)
  state.createdAt = chunk.created
  state.model = chunk.model
  const response = createResponsesResult({
    createdAt: state.createdAt,
    finishReason: null,
    id: state.responseId,
    model: state.model,
    output: [],
    sourcePayload: state.payload,
    usage: null,
  })
  response.status = "in_progress"

  events.push({
    type: "response.created",
    sequence_number: nextResponsesSequenceNumber(state),
    response,
  })
  events.push({
    type: "response.in_progress",
    sequence_number: nextResponsesSequenceNumber(state),
    response,
  } as ResponseStreamEvent)
}

const ensureOpenAIChatMessageOutputItem = (
  state: OpenAIChatToResponsesStreamState,
  events: Array<ResponseStreamEvent>,
): void => {
  if (state.messageOutputIndex !== undefined) {
    return
  }

  const outputIndex = state.nextOutputIndex++
  const itemId = createResponseMessageItemId(state)
  state.messageOutputIndex = outputIndex
  state.messageItemId = itemId
  const item: ResponseOutputMessage = {
    id: itemId,
    type: "message",
    role: "assistant",
    status: "in_progress",
    content: [],
  }
  state.outputItemsByIndex.set(outputIndex, item)

  events.push({
    type: "response.output_item.added",
    sequence_number: nextResponsesSequenceNumber(state),
    output_index: outputIndex,
    item,
  })
  events.push({
    type: "response.content_part.added",
    sequence_number: nextResponsesSequenceNumber(state),
    output_index: outputIndex,
    content_index: 0,
    item_id: itemId,
    part: {
      type: "output_text",
      text: "",
      annotations: [],
    },
  } as ResponseStreamEvent)
}

const translateOpenAIChatToolCallDeltaToResponsesEvents = (
  delta: ChatToolCallDelta,
  state: OpenAIChatToResponsesStreamState,
): Array<ResponseStreamEvent> => {
  const events: Array<ResponseStreamEvent> = []
  let toolCallState = state.toolCallsByChatIndex.get(delta.index)

  if (!toolCallState) {
    const outputIndex = state.nextOutputIndex++
    const itemId =
      delta.id ?? `${state.responseId ?? "resp"}_tool_${delta.index}`
    toolCallState = {
      outputIndex,
      itemId,
      callId: delta.id ?? itemId,
      name: delta.function?.name ?? `function_${delta.index}`,
      arguments: "",
      done: false,
    }
    state.toolCallsByChatIndex.set(delta.index, toolCallState)
    const item = createResponsesFunctionCallItem(toolCallState)
    state.outputItemsByIndex.set(outputIndex, item)
    events.push({
      type: "response.output_item.added",
      sequence_number: nextResponsesSequenceNumber(state),
      output_index: outputIndex,
      item,
    })
  }

  if (delta.id) {
    toolCallState.callId = delta.id
  }
  if (delta.function?.name) {
    toolCallState.name = delta.function.name
  }

  const argumentsDelta = delta.function?.arguments ?? ""
  if (argumentsDelta.length > 0) {
    toolCallState.arguments += argumentsDelta
    const item = createResponsesFunctionCallItem(toolCallState)
    state.outputItemsByIndex.set(toolCallState.outputIndex, item)
    events.push({
      type: "response.function_call_arguments.delta",
      sequence_number: nextResponsesSequenceNumber(state),
      output_index: toolCallState.outputIndex,
      item_id: toolCallState.itemId,
      delta: argumentsDelta,
    })
  }

  return events
}

const closeOpenAIChatResponseOutputItems = (
  state: OpenAIChatToResponsesStreamState,
): Array<ResponseStreamEvent> => {
  const events: Array<ResponseStreamEvent> = []

  if (
    state.messageOutputIndex !== undefined
    && state.messageItemId
    && !state.messageDone
  ) {
    const item: ResponseOutputMessage = {
      id: state.messageItemId,
      type: "message",
      role: "assistant",
      status: state.finishReason === "length" ? "incomplete" : "completed",
      content: [
        {
          type: "output_text",
          text: state.messageText,
          annotations: [],
        },
      ],
    }
    state.outputItemsByIndex.set(state.messageOutputIndex, item)
    events.push({
      type: "response.output_text.done",
      sequence_number: nextResponsesSequenceNumber(state),
      output_index: state.messageOutputIndex,
      content_index: 0,
      item_id: state.messageItemId,
      text: state.messageText,
    })
    events.push({
      type: "response.content_part.done",
      sequence_number: nextResponsesSequenceNumber(state),
      output_index: state.messageOutputIndex,
      content_index: 0,
      item_id: state.messageItemId,
      part: {
        type: "output_text",
        text: state.messageText,
        annotations: [],
      },
    } as ResponseStreamEvent)
    events.push({
      type: "response.output_item.done",
      sequence_number: nextResponsesSequenceNumber(state),
      output_index: state.messageOutputIndex,
      item,
    })
    state.messageDone = true
  }

  for (const toolCallState of state.toolCallsByChatIndex.values()) {
    if (toolCallState.done) {
      continue
    }

    toolCallState.done = true
    const item = createResponsesFunctionCallItem(toolCallState)
    state.outputItemsByIndex.set(toolCallState.outputIndex, item)
    events.push({
      type: "response.function_call_arguments.done",
      sequence_number: nextResponsesSequenceNumber(state),
      output_index: toolCallState.outputIndex,
      item_id: toolCallState.itemId,
      name: toolCallState.name,
      arguments: toolCallState.arguments,
    })
    events.push({
      type: "response.output_item.done",
      sequence_number: nextResponsesSequenceNumber(state),
      output_index: toolCallState.outputIndex,
      item,
    })
  }

  return events
}

const createResponsesFunctionCallItem = (
  state: OpenAIChatToolCallStreamState,
): ResponseOutputFunctionCall => ({
  id: state.itemId,
  type: "function_call",
  call_id: state.callId,
  name: state.name,
  arguments: state.arguments,
  status: state.done ? "completed" : "in_progress",
})

const createResponseMessageItemId = (
  state: OpenAIChatToResponsesStreamState,
): string => `${state.responseId ?? "resp"}_msg`

const getOrderedResponsesOutputItems = (
  state: OpenAIChatToResponsesStreamState,
): Array<ResponseOutputItem> =>
  [...state.outputItemsByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, item]) => item)

const nextResponsesSequenceNumber = (
  state: OpenAIChatToResponsesStreamState,
): number => ++state.sequenceNumber

const toResponsesId = (id: string): string =>
  id.startsWith("resp") ? id : `resp_${id}`

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

const mapOpenAIContentToResponsesContent = (
  content: Message["content"],
  role: "assistant" | "user",
): string | Array<ResponseInputContent> => {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  const textType = role === "assistant" ? "output_text" : "input_text"
  const mapped = content.flatMap((part): Array<ResponseInputContent> => {
    if (part.type === "text") {
      return [{ type: textType, text: part.text }]
    }

    if (part.type === "image_url") {
      return [
        {
          type: "input_image",
          image_url: part.image_url.url,
          detail: part.image_url.detail ?? "auto",
        },
      ]
    }

    if (part.type === "file") {
      return [
        {
          type: "input_file",
          file_data: part.file.file_data,
          filename: part.file.filename,
        },
      ]
    }

    return []
  })

  return mapped.length > 0 ? mapped : ""
}

const createResponsesMessage = (
  role: ResponseInputMessage["role"],
  content: Message["content"],
): ResponseInputMessage => ({
  type: "message",
  role,
  content: mapOpenAIContentToResponsesContent(
    content,
    role === "assistant" ? "assistant" : "user",
  ),
})

const hasResponsesContent = (
  content: string | Array<ResponseInputContent>,
): boolean => {
  if (typeof content === "string") {
    return content.length > 0
  }

  return content.length > 0
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

const translateOpenAIToolsToResponses = (
  tools: ChatCompletionsPayload["tools"],
): Array<ResponsesTool> | null => {
  if (!tools || tools.length === 0) {
    return null
  }

  return tools.flatMap((tool): Array<FunctionTool> => {
    if (tool.type !== "function") {
      return []
    }

    return [
      {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters ?? {},
        strict: false,
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

const translateOpenAIToolChoiceToResponses = (
  toolChoice: ChatCompletionsPayload["tool_choice"],
): ToolChoiceOptions | ToolChoiceFunction | undefined => {
  if (!toolChoice) {
    return "auto"
  }

  if (
    toolChoice === "auto"
    || toolChoice === "none"
    || toolChoice === "required"
  ) {
    return toolChoice
  }

  return {
    type: "function",
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
    state.outputTokens = event.usage.output_tokens
    state.cacheCreationInputTokens =
      event.usage.cache_creation_input_tokens ?? state.cacheCreationInputTokens
    state.cacheReadInputTokens =
      event.usage.cache_read_input_tokens ?? state.cacheReadInputTokens
  }

  return createChatCompletionChunk(
    state,
    {},
    mapAnthropicStopReasonToOpenAI(event.delta.stop_reason ?? null),
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

const normalizeResponsesReasoningEffort = (
  effort: ChatCompletionsPayload["reasoning_effort"],
): NonNullable<ResponsesPayload["reasoning"]>["effort"] | undefined => {
  if (
    effort === "none"
    || effort === "minimal"
    || effort === "low"
    || effort === "medium"
    || effort === "high"
    || effort === "xhigh"
    || effort === "max"
  ) {
    return effort
  }

  return undefined
}

const normalizeResponsesEffortForOpenAIChat = (
  effort: NonNullable<ResponsesPayload["reasoning"]>["effort"] | undefined,
): ChatCompletionsPayload["reasoning_effort"] | undefined => {
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

const getTextFromOpenAIContent = (content: Message["content"]): string => {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .flatMap((part) => {
      const text = translateOpenAIContentPartToText(part)
      return text ? [text] : []
    })
    .join("\n")
}

const translateOpenAIContentPartToText = (
  part: ContentPart,
): string | undefined => {
  if (part.type === "text") {
    return part.text
  }

  if (part.type === "image_url") {
    return parseDataUrl(part.image_url.url) ? undefined : part.image_url.url
  }

  if (part.type === "file") {
    return parseDataUrl(part.file.file_data) ? undefined : (
        (part.file.filename ?? part.file.file_data)
      )
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

const parseDataUrl = (
  value: string,
): { mediaType: string; data: string } | null => {
  const match = /^data:([^;,]+);base64,(.*)$/u.exec(value)
  if (!match) {
    return null
  }

  return {
    mediaType: match[1],
    data: match[2],
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const nowSeconds = (): number => Math.floor(Date.now() / 1000)
