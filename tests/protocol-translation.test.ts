import { describe, expect, test } from "bun:test"

import type { AnthropicStreamEventData } from "../src/routes/messages/anthropic-types"
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
} from "../src/services/copilot/create-chat-completions"
import type { ResponsesPayload } from "../src/services/copilot/create-responses"

import {
  createChatStreamTranslationState,
  translateAnthropicStreamEventToOpenAIResult,
} from "../src/routes/translation/chat-to-anthropic"
import { translateOpenAIChatToResponsesPayload } from "../src/routes/translation/chat-to-responses"
import {
  createOpenAIChatToResponsesStreamState,
  finalizeOpenAIChatToResponsesStream,
  translateOpenAIChatResponseToResponsesResult,
  translateOpenAIChatStreamChunkToResponsesEvents,
  translateResponsesPayloadToOpenAIChat,
} from "../src/routes/translation/responses-to-chat"

const NAMESPACE_TOOLS: ResponsesPayload["tools"] = [
  {
    type: "namespace",
    name: "mcp__fetch",
    tools: [
      {
        type: "function",
        name: "fetch",
        description: "Fetch a URL",
        parameters: { type: "object", properties: {} },
        strict: false,
      },
    ],
  },
]

const createChatChunk = (
  delta: ChatCompletionChunk["choices"][number]["delta"],
  finishReason: ChatCompletionChunk["choices"][number]["finish_reason"] = null,
): ChatCompletionChunk => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 1,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
})

describe("Responses -> Chat request translation", () => {
  test("keeps easy-input messages without an explicit type", () => {
    const chatPayload = translateResponsesPayloadToOpenAIChat({
      model: "m",
      input: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "second" }],
        },
      ],
    })

    expect(chatPayload.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "second" },
    ])
  })

  test("merges a reasoning item into the following assistant message", () => {
    const chatPayload = translateResponsesPayloadToOpenAIChat({
      model: "m",
      input: [
        { type: "message", role: "user", content: "q" },
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "thinking..." }],
          encrypted_content: "opaque123",
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "answer" }],
        },
      ],
    })

    expect(chatPayload.messages).toEqual([
      { role: "user", content: "q" },
      {
        role: "assistant",
        content: "answer",
        reasoning_content: "thinking...",
        reasoning_opaque: "opaque123",
      },
    ])
  })

  test("merges a reasoning item into the assistant tool-call message", () => {
    const chatPayload = translateResponsesPayloadToOpenAIChat({
      model: "m",
      input: [
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "planning" }],
          encrypted_content: "sig",
        },
        {
          type: "function_call",
          call_id: "call-1",
          name: "lookup",
          arguments: "{}",
          status: "completed",
        },
      ],
    })

    expect(chatPayload.messages).toHaveLength(1)
    expect(chatPayload.messages[0]).toMatchObject({
      role: "assistant",
      content: null,
      reasoning_content: "planning",
      reasoning_opaque: "sig",
      tool_calls: [{ id: "call-1" }],
    })
  })

  test("flattens namespaced names consistently across tools, tool_choice, and replayed calls", () => {
    const chatPayload = translateResponsesPayloadToOpenAIChat({
      model: "m",
      input: [
        {
          type: "function_call",
          call_id: "call-1",
          name: "fetch",
          namespace: "mcp__fetch",
          arguments: "{}",
          status: "completed",
        },
        {
          type: "function_call_output",
          call_id: "call-1",
          output: "page content",
          status: "completed",
        },
      ],
      tools: NAMESPACE_TOOLS,
      tool_choice: { type: "function", name: "fetch" },
    })

    expect(chatPayload.tools?.[0].function.name).toBe("mcp__fetch__fetch")
    expect(chatPayload.tool_choice).toEqual({
      type: "function",
      function: { name: "mcp__fetch__fetch" },
    })
    expect(chatPayload.messages[0].tool_calls?.[0].function.name).toBe(
      "mcp__fetch__fetch",
    )
  })

  test("repairs interleaved multi-turn tool ordering without breaking adjacency", () => {
    const chatPayload = translateResponsesPayloadToOpenAIChat({
      model: "m",
      input: [
        {
          type: "function_call",
          call_id: "t1",
          name: "a",
          arguments: "{}",
          status: "completed",
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "some text" }],
        },
        {
          type: "function_call",
          call_id: "t2",
          name: "b",
          arguments: "{}",
          status: "completed",
        },
        {
          type: "function_call_output",
          call_id: "t2",
          output: "r2",
          status: "completed",
        },
        {
          type: "function_call_output",
          call_id: "t1",
          output: "r1",
          status: "completed",
        },
      ],
    })

    // Every assistant tool-call message must be immediately followed by the
    // tool results for exactly its own calls
    expect(
      chatPayload.messages.map((message) => ({
        role: message.role,
        toolCallIds: message.tool_calls?.map((toolCall) => toolCall.id),
        toolCallId: message.tool_call_id,
      })),
    ).toEqual([
      { role: "assistant", toolCallIds: ["t1"], toolCallId: undefined },
      { role: "tool", toolCallIds: undefined, toolCallId: "t1" },
      { role: "assistant", toolCallIds: ["t2"], toolCallId: undefined },
      { role: "tool", toolCallIds: undefined, toolCallId: "t2" },
    ])
  })

  test("passes minimal reasoning effort through to chat", () => {
    const chatPayload = translateResponsesPayloadToOpenAIChat({
      model: "m",
      input: "hi",
      reasoning: { effort: "minimal" },
    })

    expect(chatPayload.reasoning_effort).toBe("minimal")
  })
})

describe("Chat -> Responses result translation", () => {
  test("restores namespaced tool names on function_call output items", () => {
    const chatResponse: ChatCompletionResponse = {
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: "m",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "mcp__fetch__fetch", arguments: "{}" },
              },
            ],
          },
          logprobs: null,
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }

    const result = translateOpenAIChatResponseToResponsesResult(chatResponse, {
      model: "m",
      input: "hi",
      tools: NAMESPACE_TOOLS,
    })

    expect(result.output[0]).toMatchObject({
      type: "function_call",
      call_id: "call-1",
      name: "fetch",
      namespace: "mcp__fetch",
    })
  })
})

describe("Chat -> Responses payload translation", () => {
  test("replays assistant reasoning as a reasoning input item", () => {
    const payload: ChatCompletionsPayload = {
      model: "m",
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: "done",
          reasoning_text: "thought",
          reasoning_opaque: "sig123",
        },
        { role: "user", content: "next" },
      ],
    }

    const responsesPayload = translateOpenAIChatToResponsesPayload(payload)
    expect(responsesPayload.input?.[1]).toEqual({
      type: "reasoning",
      summary: [{ type: "summary_text", text: "thought" }],
      encrypted_content: "sig123",
    })
    expect(responsesPayload.input?.[2]).toMatchObject({
      type: "message",
      role: "assistant",
    })
  })

  test("omits parallel_tool_calls when the request has no tools", () => {
    const withoutTools = translateOpenAIChatToResponsesPayload({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    })
    expect("parallel_tool_calls" in withoutTools).toBe(false)

    const withTools = translateOpenAIChatToResponsesPayload({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: { name: "lookup", parameters: {} },
        },
      ],
    })
    expect(withTools.parallel_tool_calls).toBe(true)
  })
})

describe("Anthropic stream -> Chat chunk translation", () => {
  const messageStart: AnthropicStreamEventData = {
    type: "message_start",
    message: {
      id: "msg-1",
      model: "m",
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  } as AnthropicStreamEventData

  test("usage-only message_delta does not emit a premature finish_reason", () => {
    const state = createChatStreamTranslationState("m")
    translateAnthropicStreamEventToOpenAIResult(messageStart, state)

    const heartbeat = translateAnthropicStreamEventToOpenAIResult(
      {
        type: "message_delta",
        delta: {},
        usage: { output_tokens: 5 },
      } as AnthropicStreamEventData,
      state,
    )

    expect(heartbeat.chunks).toHaveLength(1)
    expect(heartbeat.chunks[0].choices[0].finish_reason).toBeNull()
  })

  test("message_delta usage input tokens reach the chunk usage", () => {
    const state = createChatStreamTranslationState("m")
    translateAnthropicStreamEventToOpenAIResult(messageStart, state)

    const final = translateAnthropicStreamEventToOpenAIResult(
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: {
          input_tokens: 200,
          output_tokens: 50,
          cache_read_input_tokens: 800,
        },
      } as AnthropicStreamEventData,
      state,
    )

    expect(final.chunks[0].choices[0].finish_reason).toBe("stop")
    expect(final.chunks[0].usage).toMatchObject({
      prompt_tokens: 1000,
      completion_tokens: 50,
      total_tokens: 1050,
    })
  })
})

describe("Chat stream -> Responses events translation", () => {
  test("tool-call-only streams emit no empty message output item", () => {
    const state = createOpenAIChatToResponsesStreamState({
      model: "m",
      input: "hi",
    })

    const events = [
      ...translateOpenAIChatStreamChunkToResponsesEvents(
        createChatChunk({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              type: "function",
              function: { name: "lookup", arguments: "" },
            },
          ],
        }),
        state,
      ),
      ...translateOpenAIChatStreamChunkToResponsesEvents(
        createChatChunk({
          tool_calls: [{ index: 0, function: { arguments: "{}" } }],
        }),
        state,
      ),
      ...translateOpenAIChatStreamChunkToResponsesEvents(
        createChatChunk({}, "tool_calls"),
        state,
      ),
      ...finalizeOpenAIChatToResponsesStream(state),
    ]

    const addedMessageItems = events.filter(
      (event) =>
        event.type === "response.output_item.added"
        && (event as { item: { type: string } }).item.type === "message",
    )
    expect(addedMessageItems).toHaveLength(0)

    const completed = events.at(-1) as unknown as {
      type: string
      response: { output: Array<{ type: string }> }
    }
    expect(completed.type).toBe("response.completed")
    expect(completed.response.output.map((item) => item.type)).toEqual([
      "function_call",
    ])
  })

  test("reasoning deltas become a reasoning output item", () => {
    const state = createOpenAIChatToResponsesStreamState({
      model: "m",
      input: "hi",
    })

    const events = [
      ...translateOpenAIChatStreamChunkToResponsesEvents(
        createChatChunk({
          role: "assistant",
          reasoning_content: "thinking...",
        }),
        state,
      ),
      ...translateOpenAIChatStreamChunkToResponsesEvents(
        createChatChunk({ reasoning_opaque: "sig" }),
        state,
      ),
      ...translateOpenAIChatStreamChunkToResponsesEvents(
        createChatChunk({ content: "ok" }),
        state,
      ),
      ...translateOpenAIChatStreamChunkToResponsesEvents(
        createChatChunk({}, "stop"),
        state,
      ),
      ...finalizeOpenAIChatToResponsesStream(state),
    ]

    expect(
      events.some(
        (event) => event.type === "response.reasoning_summary_text.delta",
      ),
    ).toBe(true)

    const completed = events.at(-1) as unknown as {
      type: string
      response: { output: Array<Record<string, unknown>> }
    }
    expect(completed.type).toBe("response.completed")
    expect(completed.response.output[0]).toMatchObject({
      type: "reasoning",
      summary: [{ type: "summary_text", text: "thinking..." }],
      encrypted_content: "sig",
      status: "completed",
    })
    expect(completed.response.output[1]).toMatchObject({ type: "message" })
  })
})
