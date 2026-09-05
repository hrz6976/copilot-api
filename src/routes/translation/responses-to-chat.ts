import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Message,
} from "~/lib/types/chat-completions"
import type {
  ResponseFunctionCallOutputItem,
  ResponseFunctionToolCallItem,
  ResponseInputItem,
  ResponseInputMessage,
  ResponseInputReasoning,
  ResponseOutputFunctionCall,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseOutputReasoning,
  ResponsesPayload,
  ResponsesResult,
  ResponseStreamEvent,
  ResponseUsage,
} from "~/lib/types/responses"

import { isRecord, nowSeconds, type OpenAIFinishReason } from "./utils"

export class ResponsesToOpenAIChatTranslationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ResponsesToOpenAIChatTranslationError"
  }
}

export interface OpenAIChatToResponsesStreamState {
  payload: ResponsesPayload
  toolNameMaps: ResponsesToolNameMaps
  responseId?: string
  createdAt?: number
  model: string
  sequenceNumber: number
  nextOutputIndex: number
  outputItemsByIndex: Map<number, ResponseOutputItem>
  reasoningOutputIndex?: number
  reasoningItemId?: string
  reasoningText: string
  reasoningOpaque?: string
  reasoningDone: boolean
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

export const translateResponsesPayloadToOpenAIChat = (
  payload: ResponsesPayload,
): ChatCompletionsPayload => {
  const messages = translateResponsesInputToOpenAIChatMessages(payload)
  const tools = translateResponsesToolsToOpenAI(payload.tools)
  const toolChoice = translateResponsesToolChoiceToOpenAI(
    payload.tool_choice,
    buildResponsesToolNameMaps(payload.tools),
  )
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
      translateOpenAIChatChoiceToResponsesOutput(
        firstChoice,
        response.id,
        buildResponsesToolNameMaps(sourcePayload.tools),
      )
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
  toolNameMaps: buildResponsesToolNameMaps(payload.tools),
  model: payload.model,
  sequenceNumber: 0,
  nextOutputIndex: 0,
  outputItemsByIndex: new Map(),
  reasoningText: "",
  reasoningDone: false,
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

    const reasoningDelta = delta.reasoning_text ?? delta.reasoning_content
    if (reasoningDelta) {
      ensureOpenAIChatReasoningOutputItem(state, responseEvents)
      state.reasoningText += reasoningDelta
      responseEvents.push({
        type: "response.reasoning_summary_text.delta",
        sequence_number: nextResponsesSequenceNumber(state),
        output_index: state.reasoningOutputIndex ?? 0,
        summary_index: 0,
        item_id: state.reasoningItemId ?? "",
        delta: reasoningDelta,
      })
    }

    if (delta.reasoning_opaque) {
      ensureOpenAIChatReasoningOutputItem(state, responseEvents)
      state.reasoningOpaque = delta.reasoning_opaque
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

  const pending: PendingReasoningState = { reasoning: null }
  for (const item of payload.input) {
    translateResponsesInputItemToOpenAIChatMessages(item, messages, pending)
  }
  attachPendingReasoningToLastAssistantMessage(messages, pending)

  return repairOpenAIChatToolMessageOrder(messages)
}

const translateResponsesInputItemToOpenAIChatMessages = (
  item: ResponseInputItem,
  messages: Array<Message>,
  pending: PendingReasoningState,
): void => {
  if (isResponsesInputReasoning(item)) {
    // Responses output order puts reasoning before the item it belongs to,
    // so hold it and merge it into the next assistant message/tool call.
    accumulatePendingReasoning(item, pending)
    return
  }

  if (isResponsesInputMessage(item)) {
    const role = normalizeResponsesMessageRoleForOpenAIChat(item.role)
    if (role !== "assistant") {
      attachPendingReasoningToLastAssistantMessage(messages, pending)
    }
    const message: Message = {
      role,
      content: translateResponsesInputContentToOpenAIChatContent(item.content),
    }
    messages.push(message)
    if (role === "assistant") {
      applyPendingReasoning(message, pending)
    }
    return
  }

  if (isResponsesFunctionToolCallInput(item)) {
    pushResponsesFunctionCallAsOpenAIChatToolCall(item, messages, pending)
    return
  }

  if (isResponsesFunctionCallOutputInput(item)) {
    attachPendingReasoningToLastAssistantMessage(messages, pending)
    messages.push({
      role: "tool",
      tool_call_id: item.call_id,
      content: translateResponsesToolOutputToOpenAIChatContent(item.output),
    })
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
  isRecord(item)
  // OpenAI SDKs emit bare `{ role, content }` easy-input items without `type`
  && (item.type === "message" || item.type === undefined)
  && typeof item.role === "string"

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
  pending: PendingReasoningState,
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
    applyPendingReasoning(lastMessage, pending)
    return
  }

  const assistantMessage: Message = {
    role: "assistant",
    content: null,
    tool_calls: [toolCall],
  }
  messages.push(assistantMessage)
  applyPendingReasoning(assistantMessage, pending)
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
    // Must match the flattened name the tool was declared under
    return normalizeOpenAIChatFunctionName(item.name, namespace)
  }

  return item.name
}

interface PendingReasoning {
  text?: string
  opaque?: string
}

interface PendingReasoningState {
  reasoning: PendingReasoning | null
}

const accumulatePendingReasoning = (
  item: ResponseInputReasoning,
  pending: PendingReasoningState,
): void => {
  const text = item.summary
    .flatMap((block) =>
      block.type === "summary_text" && block.text ? [block.text] : [],
    )
    .join("\n\n")
  const opaque =
    typeof item.encrypted_content === "string" && item.encrypted_content ?
      item.encrypted_content
    : undefined

  if (!text && !opaque) {
    return
  }

  const reasoning = (pending.reasoning ??= {})
  if (text) {
    reasoning.text = [reasoning.text, text]
      .filter((value): value is string => Boolean(value))
      .join("\n\n")
  }
  if (opaque) {
    reasoning.opaque = opaque
  }
}

const applyPendingReasoning = (
  message: Message,
  pending: PendingReasoningState,
): void => {
  const reasoning = pending.reasoning
  if (!reasoning) {
    return
  }
  pending.reasoning = null

  if (reasoning.text) {
    message.reasoning_content = [message.reasoning_content, reasoning.text]
      .filter((value): value is string => Boolean(value))
      .join("\n\n")
  }
  if (reasoning.opaque) {
    message.reasoning_opaque = reasoning.opaque
  }
}

const attachPendingReasoningToLastAssistantMessage = (
  messages: Array<Message>,
  pending: PendingReasoningState,
): void => {
  if (!pending.reasoning) {
    return
  }

  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "assistant") {
      applyPendingReasoning(messages[index], pending)
      return
    }
  }

  // No assistant message to attach to; dropping is better than emitting an
  // invalid null-content assistant message.
  pending.reasoning = null
}

// Every assistant message that carries tool_calls must be immediately
// followed by the tool messages answering those calls. Rebuild the list so
// each tool result sits directly after the assistant message that owns it,
// preserving relative order everywhere else.
const repairOpenAIChatToolMessageOrder = (
  messages: Array<Message>,
): Array<Message> => {
  const toolMessagesByCallId = new Map<string, Message>()
  for (const message of messages) {
    if (
      message.role === "tool"
      && message.tool_call_id
      && !toolMessagesByCallId.has(message.tool_call_id)
    ) {
      toolMessagesByCallId.set(message.tool_call_id, message)
    }
  }

  const claimed = new Set<Message>()
  const repaired: Array<Message> = []
  for (const message of messages) {
    if (claimed.has(message)) {
      continue
    }

    repaired.push(message)
    if (message.role !== "assistant") {
      continue
    }

    for (const toolCall of message.tool_calls ?? []) {
      const toolMessage = toolMessagesByCallId.get(toolCall.id)
      if (toolMessage && !claimed.has(toolMessage)) {
        claimed.add(toolMessage)
        repaired.push(toolMessage)
      }
    }
  }

  return repaired
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
  nameMaps: ResponsesToolNameMaps,
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
        // A namespaced tool is declared under its flattened name, so the
        // forced choice must reference the same name
        name:
          nameMaps.flattenedByInnerName.get(toolChoice.name) ?? toolChoice.name,
      },
    }
  }

  return undefined
}

interface ResponsesToolNameMaps {
  // Inner tool name -> flattened chat tool name (only when unambiguous)
  flattenedByInnerName: Map<string, string>
  // Flattened chat tool name -> original Responses name/namespace
  restoreByFlattenedName: Map<string, { name: string; namespace?: string }>
}

const buildResponsesToolNameMaps = (
  tools: ResponsesPayload["tools"],
): ResponsesToolNameMaps => {
  const flattenedByInnerName = new Map<string, string>()
  const ambiguousInnerNames = new Set<string>()
  const restoreByFlattenedName = new Map<
    string,
    { name: string; namespace?: string }
  >()

  const register = (innerName: string, flattenedName: string) => {
    if (flattenedByInnerName.has(innerName)) {
      ambiguousInnerNames.add(innerName)
    } else {
      flattenedByInnerName.set(innerName, flattenedName)
    }
  }

  for (const tool of tools ?? []) {
    if (!isRecord(tool)) {
      continue
    }

    if (
      tool.type === "namespace"
      && typeof tool.name === "string"
      && Array.isArray(tool.tools)
    ) {
      const namespace = tool.name
      for (const innerTool of tool.tools) {
        if (!isRecord(innerTool) || typeof innerTool.name !== "string") {
          continue
        }
        const flattenedName = normalizeOpenAIChatFunctionName(
          innerTool.name,
          namespace,
        )
        restoreByFlattenedName.set(flattenedName, {
          name: innerTool.name,
          namespace,
        })
        register(innerTool.name, flattenedName)
      }
      continue
    }

    if (tool.type === "function" && typeof tool.name === "string") {
      restoreByFlattenedName.set(tool.name, { name: tool.name })
      register(tool.name, tool.name)
    }
  }

  for (const innerName of ambiguousInnerNames) {
    flattenedByInnerName.delete(innerName)
  }

  return { flattenedByInnerName, restoreByFlattenedName }
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
  nameMaps: ResponsesToolNameMaps,
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
    const restored = nameMaps.restoreByFlattenedName.get(toolCall.function.name)
    output.push({
      type: "function_call",
      call_id: toolCall.id,
      name: restored?.name ?? toolCall.function.name,
      ...(restored?.namespace ? { namespace: restored.namespace } : {}),
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

const ensureOpenAIChatReasoningOutputItem = (
  state: OpenAIChatToResponsesStreamState,
  events: Array<ResponseStreamEvent>,
): void => {
  if (state.reasoningOutputIndex !== undefined) {
    return
  }

  const outputIndex = state.nextOutputIndex++
  const itemId = `${state.responseId ?? "resp"}_reasoning`
  state.reasoningOutputIndex = outputIndex
  state.reasoningItemId = itemId
  const item: ResponseOutputReasoning = {
    id: itemId,
    type: "reasoning",
    status: "in_progress",
    summary: [],
  }
  state.outputItemsByIndex.set(outputIndex, item)

  events.push({
    type: "response.output_item.added",
    sequence_number: nextResponsesSequenceNumber(state),
    output_index: outputIndex,
    item,
  })
  events.push({
    type: "response.reasoning_summary_part.added",
    sequence_number: nextResponsesSequenceNumber(state),
    output_index: outputIndex,
    summary_index: 0,
    item_id: itemId,
    part: {
      type: "summary_text",
      text: "",
    },
  } as ResponseStreamEvent)
}

const closeOpenAIChatReasoningOutputItem = (
  state: OpenAIChatToResponsesStreamState,
  events: Array<ResponseStreamEvent>,
): void => {
  if (
    state.reasoningOutputIndex === undefined
    || !state.reasoningItemId
    || state.reasoningDone
  ) {
    return
  }

  const item: ResponseOutputReasoning = {
    id: state.reasoningItemId,
    type: "reasoning",
    status: "completed",
    summary:
      state.reasoningText ?
        [{ type: "summary_text", text: state.reasoningText }]
      : [],
    ...(state.reasoningOpaque ?
      { encrypted_content: state.reasoningOpaque }
    : {}),
  }
  state.outputItemsByIndex.set(state.reasoningOutputIndex, item)

  events.push({
    type: "response.reasoning_summary_text.done",
    sequence_number: nextResponsesSequenceNumber(state),
    output_index: state.reasoningOutputIndex,
    summary_index: 0,
    item_id: state.reasoningItemId,
    text: state.reasoningText,
  } as ResponseStreamEvent)
  events.push({
    type: "response.reasoning_summary_part.done",
    sequence_number: nextResponsesSequenceNumber(state),
    output_index: state.reasoningOutputIndex,
    summary_index: 0,
    item_id: state.reasoningItemId,
    part: {
      type: "summary_text",
      text: state.reasoningText,
    },
  } as ResponseStreamEvent)
  events.push({
    type: "response.output_item.done",
    sequence_number: nextResponsesSequenceNumber(state),
    output_index: state.reasoningOutputIndex,
    item,
  })
  state.reasoningDone = true
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
    const item = createResponsesFunctionCallItem(state, toolCallState)
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
    const item = createResponsesFunctionCallItem(state, toolCallState)
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

  closeOpenAIChatReasoningOutputItem(state, events)

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
    const item = createResponsesFunctionCallItem(state, toolCallState)
    state.outputItemsByIndex.set(toolCallState.outputIndex, item)
    events.push({
      type: "response.function_call_arguments.done",
      sequence_number: nextResponsesSequenceNumber(state),
      output_index: toolCallState.outputIndex,
      item_id: toolCallState.itemId,
      name: item.name,
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
  state: OpenAIChatToResponsesStreamState,
  toolCallState: OpenAIChatToolCallStreamState,
): ResponseOutputFunctionCall => {
  const restored = state.toolNameMaps.restoreByFlattenedName.get(
    toolCallState.name,
  )
  return {
    id: toolCallState.itemId,
    type: "function_call",
    call_id: toolCallState.callId,
    name: restored?.name ?? toolCallState.name,
    ...(restored?.namespace ? { namespace: restored.namespace } : {}),
    arguments: toolCallState.arguments,
    status: toolCallState.done ? "completed" : "in_progress",
  }
}

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

const normalizeResponsesEffortForOpenAIChat = (
  effort: NonNullable<ResponsesPayload["reasoning"]>["effort"] | undefined,
): ChatCompletionsPayload["reasoning_effort"] | undefined => {
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
