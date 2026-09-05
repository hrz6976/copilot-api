import {
  createResponsesStreamState,
  translateResponsesStreamEvent,
  type ResponsesStreamState,
} from "~/routes/messages/responses-stream-translation"
import { translateResponsesResultToAnthropic } from "~/routes/messages/responses-translation"
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  Message,
} from "~/lib/types/chat-completions"
import type {
  FunctionTool,
  ResponseInputContent,
  ResponseInputItem,
  ResponseInputMessage,
  ResponsesPayload,
  ResponsesResult,
  ResponseStreamEvent,
  Tool as ResponsesTool,
  ToolChoiceFunction,
  ToolChoiceOptions,
} from "~/lib/types/responses"

import {
  type ChatStreamTranslationResult,
  type ChatStreamTranslationState,
  createChatStreamTranslationState,
  translateAnthropicResponseToOpenAIChat,
  translateAnthropicStreamEventToOpenAIChunks,
  translateAnthropicStreamEventToOpenAIResult,
} from "./chat-to-anthropic"
import { getTextFromOpenAIContent } from "./utils"

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
        // Replay reasoning so Responses backends keep reasoning continuity
        // across tool-call turns (encrypted_content is required to do so).
        if (message.reasoning_opaque) {
          const reasoningText =
            message.reasoning_text ?? message.reasoning_content
          input.push({
            type: "reasoning",
            summary:
              reasoningText ?
                [{ type: "summary_text", text: reasoningText }]
              : [],
            encrypted_content: message.reasoning_opaque,
          })
        }

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
  const tools = translateOpenAIToolsToResponses(payload.tools)

  return {
    model: payload.model,
    input,
    instructions: instructions.length > 0 ? instructions.join("\n\n") : null,
    tools,
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
    // Only meaningful with tools; some upstreams reject it without them
    ...(tools?.length ?
      { parallel_tool_calls: payload.parallel_tool_calls ?? true }
    : {}),
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

export const translateResponsesResultToOpenAIChat = (
  response: ResponsesResult,
): ChatCompletionResponse =>
  translateAnthropicResponseToOpenAIChat(
    translateResponsesResultToAnthropic(response),
  )

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
