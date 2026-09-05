import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Hono } from "hono"

import type { ResolvedProviderConfig } from "~/lib/config"

const actualConfigModule = await import("~/lib/config")
const actualTokenUsageModule = await import("~/lib/token-usage")

let providerConfig: ResolvedProviderConfig | null = null
let modelMappings: Record<string, string> = {}

const noopTokenUsageRecorder = () => {}

await mock.module("~/lib/config", () => ({
  ...actualConfigModule,
  getProviderConfig: () => providerConfig,
  resolveMappedModel: (model: string) => modelMappings[model] ?? model,
}))

await mock.module("~/lib/token-usage", () => ({
  ...actualTokenUsageModule,
  createProviderTokenUsageRecorder: () => noopTokenUsageRecorder,
}))

const { completionRoutes } = await import("~/routes/chat-completions/route")

const originalFetch = globalThis.fetch

const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            logprobs: null,
            message: {
              content: "answer text",
              role: "assistant",
            },
          },
        ],
        created: 0,
        id: "chatcmpl-test",
        model: "qwen-plus",
        object: "chat.completion",
        usage: {
          completion_tokens: 2,
          prompt_tokens: 8,
          total_tokens: 10,
        },
      }),
      {
        headers: {
          "content-type": "application/json",
        },
      },
    ),
  ),
)

const createApp = () => {
  const app = new Hono()
  app.route("/v1/chat/completions", completionRoutes)
  return app
}

beforeEach(() => {
  providerConfig = {
    apiKey: "provider-key",
    authType: "authorization",
    baseUrl: "https://dashscope.example/compatible-mode",
    models: {
      "qwen-plus": {
        extraBody: {
          enable_thinking: true,
          preserve_thinking: true,
        },
        temperature: 0.2,
        topK: 50,
        topP: 0.8,
      },
    },
    name: "dash",
    type: "openai-compatible",
  }

  modelMappings = {}
  fetchMock.mockClear()
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch =
    fetchMock as unknown as typeof fetch
})

afterEach(() => {
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch
  providerConfig = null
})

describe("provider/model aliases on top-level chat completions route", () => {
  test("routes mapped models to provider chat completions before rate limiting", async () => {
    modelMappings = {
      "gpt-provider": "dash/qwen-plus",
    }

    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        model: "gpt-provider",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      "https://dashscope.example/compatible-mode/v1/chat/completions",
    )
    expect((init as RequestInit).headers).toEqual({
      "content-type": "application/json",
      accept: "application/json",
      authorization: "Bearer provider-key",
    })

    const upstreamBody = JSON.parse((init as RequestInit).body as string) as {
      model: string
    }
    expect(upstreamBody.model).toBe("qwen-plus")
  })

  test("strips provider prefix and applies provider model defaults", async () => {
    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        model: "dash/qwen-plus",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const init = fetchMock.mock.calls[0][1] as RequestInit
    const upstreamBody = JSON.parse(init.body as string) as Record<
      string,
      unknown
    >
    expect(upstreamBody).toMatchObject({
      enable_thinking: true,
      model: "qwen-plus",
      preserve_thinking: true,
      temperature: 0.2,
      top_k: 50,
      top_p: 0.8,
    })
  })

  test("keeps request fields over provider defaults and adds stream usage option", async () => {
    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        enable_thinking: false,
        messages: [{ content: "hello", role: "user" }],
        model: "dash/qwen-plus",
        stream: true,
        stream_options: {
          include_usage: false,
        },
        temperature: 0.4,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const upstreamBody = JSON.parse(init.body as string) as Record<
      string,
      unknown
    >
    expect(upstreamBody.temperature).toBe(0.4)
    expect(upstreamBody.enable_thinking).toBe(false)
    expect(upstreamBody.stream_options).toEqual({
      include_usage: true,
    })
  })

  test("uses max_completion_tokens for GPT-series OpenAI-compatible providers", async () => {
    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        max_tokens: 512,
        messages: [{ content: "hello", role: "user" }],
        model: "dash/gpt-5.2-codex",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const upstreamBody = JSON.parse(init.body as string) as Record<
      string,
      unknown
    >
    expect(upstreamBody.model).toBe("gpt-5.2-codex")
    expect(upstreamBody.max_completion_tokens).toBe(512)
    expect(upstreamBody).not.toHaveProperty("max_tokens")
  })

  test("forwards a thrown mid-stream error as an OpenAI chat error event", async () => {
    fetchMock.mockImplementationOnce(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              "data: "
                + JSON.stringify({
                  id: "chatcmpl",
                  object: "chat.completion.chunk",
                  created: 0,
                  model: "qwen-plus",
                  choices: [
                    {
                      index: 0,
                      delta: { role: "assistant", content: "partial" },
                      finish_reason: null,
                      logprobs: null,
                    },
                  ],
                })
                + "\n\n",
            ),
          )
          controller.error(new Error("upstream boom"))
        },
      })
      return Promise.resolve(
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        }),
      )
    })

    const response = await createApp().request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [{ content: "hi", role: "user" }],
        model: "dash/qwen-plus",
        stream: true,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain("event: error")
    expect(text).toContain("upstream boom")
    expect(text).toContain("data: [DONE]")
  })

  test("translates chat completions to openai-responses providers", async () => {
    providerConfig = {
      ...(providerConfig as ResolvedProviderConfig),
      baseUrl: "https://responses.example",
      models: {
        "gpt-resp": {},
      },
      type: "openai-responses",
    }
    fetchMock.mockImplementationOnce(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp-test",
              object: "response",
              created_at: 0,
              model: "gpt-resp",
              output: [
                {
                  id: "msg-1",
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [
                    {
                      type: "output_text",
                      text: "answer from responses",
                      annotations: [],
                    },
                  ],
                },
              ],
              output_text: "answer from responses",
              status: "completed",
              usage: {
                input_tokens: 10,
                output_tokens: 3,
                total_tokens: 13,
                input_tokens_details: {
                  cached_tokens: 2,
                },
              },
              error: null,
              incomplete_details: null,
              instructions: null,
              metadata: null,
              parallel_tool_calls: true,
              temperature: null,
              tool_choice: "auto",
              tools: [],
              top_p: null,
            }),
            {
              headers: {
                "content-type": "application/json",
              },
            },
          ),
        ),
    )

    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        max_tokens: 256,
        messages: [
          { content: "system prompt", role: "system" },
          { content: "hello", role: "user" },
        ],
        model: "dash/gpt-resp",
        tools: [
          {
            type: "function",
            function: {
              name: "lookup",
              description: "Lookup data",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://responses.example/v1/responses")

    const upstreamBody = JSON.parse((init as RequestInit).body as string) as {
      input: Array<Record<string, unknown>>
      instructions: string
      max_output_tokens: number
      model: string
      tools: Array<Record<string, unknown>>
    }
    expect(upstreamBody).toMatchObject({
      instructions: "system prompt",
      max_output_tokens: 256,
      model: "gpt-resp",
      tools: [
        {
          type: "function",
          name: "lookup",
          strict: false,
        },
      ],
    })
    expect(upstreamBody.input).toEqual([
      {
        type: "message",
        role: "user",
        content: "hello",
      },
    ])

    expect(await response.json()).toMatchObject({
      object: "chat.completion",
      model: "gpt-resp",
      choices: [
        {
          message: {
            role: "assistant",
            content: "answer from responses",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 3,
        total_tokens: 13,
      },
    })
  })
})

describe("translated provider chat completions", () => {
  test("streams openai-responses providers as chat completion chunks", async () => {
    providerConfig = {
      ...(providerConfig as ResolvedProviderConfig),
      baseUrl: "https://responses.example",
      models: {
        "gpt-resp": {},
      },
      type: "openai-responses",
    }

    const responseBody = {
      id: "resp-stream",
      object: "response",
      created_at: 0,
      model: "gpt-resp",
      output: [],
      output_text: "",
      status: "completed",
      usage: {
        input_tokens: 5,
        output_tokens: 2,
        total_tokens: 7,
      },
      error: null,
      incomplete_details: null,
      instructions: null,
      metadata: null,
      parallel_tool_calls: true,
      temperature: null,
      tool_choice: "auto",
      tools: [],
      top_p: null,
    }
    fetchMock.mockImplementationOnce(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            [
              [
                "event: response.created",
                `data: ${JSON.stringify({
                  type: "response.created",
                  sequence_number: 1,
                  response: responseBody,
                })}`,
              ].join("\n"),
              [
                "event: response.output_item.added",
                `data: ${JSON.stringify({
                  type: "response.output_item.added",
                  sequence_number: 2,
                  output_index: 0,
                  item: {
                    id: "msg-1",
                    type: "message",
                    role: "assistant",
                    status: "in_progress",
                    content: [],
                  },
                })}`,
              ].join("\n"),
              [
                "event: response.output_text.delta",
                `data: ${JSON.stringify({
                  type: "response.output_text.delta",
                  sequence_number: 3,
                  output_index: 0,
                  content_index: 0,
                  item_id: "msg-1",
                  delta: "stream answer",
                })}`,
              ].join("\n"),
              [
                "event: response.output_text.done",
                `data: ${JSON.stringify({
                  type: "response.output_text.done",
                  sequence_number: 4,
                  output_index: 0,
                  content_index: 0,
                  item_id: "msg-1",
                  text: "stream answer",
                })}`,
              ].join("\n"),
              [
                "event: response.completed",
                `data: ${JSON.stringify({
                  type: "response.completed",
                  sequence_number: 5,
                  response: responseBody,
                })}`,
              ].join("\n"),
              "",
            ].join("\n\n"),
            {
              headers: {
                "content-type": "text/event-stream",
              },
            },
          ),
        ),
    )

    const response = await createApp().request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        model: "dash/gpt-resp",
        stream: true,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('"object":"chat.completion.chunk"')
    expect(text).toContain('"content":"stream answer"')
    expect(text).toContain('"finish_reason":"stop"')
    expect(text).toContain("data: [DONE]")
  })

  test("surfaces openai-responses stream failures as chat stream errors", async () => {
    providerConfig = {
      ...(providerConfig as ResolvedProviderConfig),
      baseUrl: "https://responses.example",
      models: {
        "gpt-resp": {},
      },
      type: "openai-responses",
    }

    const responseBody = {
      id: "resp-failed",
      object: "response",
      created_at: 0,
      model: "gpt-resp",
      output: [],
      output_text: "",
      status: "failed",
      usage: {
        input_tokens: 5,
        output_tokens: 0,
        total_tokens: 5,
      },
      error: {
        code: "server_error",
        message: "responses failed",
        type: "server_error",
      },
      incomplete_details: null,
      instructions: null,
      metadata: null,
      parallel_tool_calls: true,
      temperature: null,
      tool_choice: "auto",
      tools: [],
      top_p: null,
    }
    fetchMock.mockImplementationOnce(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            [
              [
                "event: response.created",
                `data: ${JSON.stringify({
                  type: "response.created",
                  sequence_number: 1,
                  response: responseBody,
                })}`,
              ].join("\n"),
              [
                "event: response.failed",
                `data: ${JSON.stringify({
                  type: "response.failed",
                  sequence_number: 2,
                  response: responseBody,
                })}`,
              ].join("\n"),
              "",
            ].join("\n\n"),
            {
              headers: {
                "content-type": "text/event-stream",
              },
            },
          ),
        ),
    )

    const response = await createApp().request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        model: "dash/gpt-resp",
        stream: true,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain("event: error")
    expect(text).toContain('"message":"responses failed"')
    expect(text).not.toContain('"content":"responses failed"')
  })

  test("translates chat completions to Anthropic provider messages", async () => {
    providerConfig = {
      apiKey: "anthropic-key",
      authType: "x-api-key",
      baseUrl: "https://anthropic.example",
      models: {
        "claude-test": {},
      },
      name: "anthropic",
      type: "anthropic",
    }
    fetchMock.mockImplementationOnce(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: "msg-test",
              type: "message",
              role: "assistant",
              model: "claude-test",
              content: [{ type: "text", text: "anthropic answer" }],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: {
                input_tokens: 5,
                output_tokens: 2,
                cache_read_input_tokens: 1,
              },
            }),
            {
              headers: {
                "content-type": "application/json",
              },
            },
          ),
        ),
    )

    const response = await createApp().request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [
          { content: "system prompt", role: "system" },
          { content: "hello", role: "user" },
        ],
        model: "anthropic/claude-test",
      }),
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://anthropic.example/v1/messages")
    expect((init as RequestInit).headers).toMatchObject({
      "content-type": "application/json",
      accept: "application/json",
      "x-api-key": "anthropic-key",
      "anthropic-version": "2023-06-01",
    })
    const upstreamBody = JSON.parse((init as RequestInit).body as string) as {
      max_tokens: number
      messages: Array<Record<string, unknown>>
      model: string
      system: string
    }
    expect(upstreamBody).toMatchObject({
      max_tokens: 4096,
      model: "claude-test",
      system: "system prompt",
      messages: [{ role: "user", content: "hello" }],
    })

    expect(await response.json()).toMatchObject({
      object: "chat.completion",
      model: "claude-test",
      choices: [
        {
          message: {
            role: "assistant",
            content: "anthropic answer",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 6,
        completion_tokens: 2,
        total_tokens: 8,
      },
    })
  })

  test("surfaces Anthropic provider stream errors as chat stream errors", async () => {
    providerConfig = {
      apiKey: "anthropic-key",
      authType: "x-api-key",
      baseUrl: "https://anthropic.example",
      models: {
        "claude-test": {},
      },
      name: "anthropic",
      type: "anthropic",
    }
    fetchMock.mockImplementationOnce(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            [
              [
                "event: error",
                `data: ${JSON.stringify({
                  type: "error",
                  error: {
                    type: "overloaded_error",
                    message: "anthropic overloaded",
                  },
                })}`,
              ].join("\n"),
              "",
            ].join("\n\n"),
            {
              headers: {
                "content-type": "text/event-stream",
              },
            },
          ),
        ),
    )

    const response = await createApp().request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        model: "anthropic/claude-test",
        stream: true,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain("event: error")
    expect(text).toContain('"message":"anthropic overloaded"')
    expect(text).not.toContain('"content":"anthropic overloaded"')
  })
})

describe("context cache on provider chat completions route", () => {
  test("applies context cache for dashscope providers by default", async () => {
    providerConfig = {
      ...providerConfig,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
      name: "dashscope",
      models: {
        "qwen-plus": {
          extraBody: {
            enable_thinking: true,
            preserve_thinking: true,
          },
        },
      },
    } as ResolvedProviderConfig

    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [
          { content: "system prompt", role: "system" },
          { content: "hello", role: "user" },
        ],
        model: "dashscope/qwen-plus",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ content: unknown; role: string }>
    }

    const systemMessage = body.messages[0]
    expect(Array.isArray(systemMessage.content)).toBe(true)
    const systemPart = (
      systemMessage.content as Array<Record<string, unknown>>
    )[0]
    expect(systemPart.cache_control).toEqual({ type: "ephemeral" })

    const userMessage = body.messages[1]
    expect(Array.isArray(userMessage.content)).toBe(true)
    const userPart = (userMessage.content as Array<Record<string, unknown>>)[0]
    expect(userPart.cache_control).toEqual({ type: "ephemeral" })
  })

  test("detects dashscope via aliyuncs.com in baseUrl", async () => {
    providerConfig = {
      ...providerConfig,
      baseUrl: "https://bailian.aliyuncs.com/api/v1",
      name: "my-bailian",
      models: {
        "qwen-plus": {},
      },
    } as ResolvedProviderConfig

    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        model: "my-bailian/qwen-plus",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ content: unknown; role: string }>
    }
    const userMessage = body.messages[0]
    expect(Array.isArray(userMessage.content)).toBe(true)
    const userPart = (userMessage.content as Array<Record<string, unknown>>)[0]
    expect(userPart.cache_control).toEqual({ type: "ephemeral" })
  })

  test("does not apply context cache for non-dashscope providers by default", async () => {
    providerConfig = {
      ...providerConfig,
      baseUrl: "https://api.example.com/v1",
      name: "custom",
      models: {
        "qwen-plus": {},
      },
    } as ResolvedProviderConfig

    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [
          { content: "system prompt", role: "system" },
          { content: "hello", role: "user" },
        ],
        model: "custom/qwen-plus",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ content: unknown; role: string }>
    }
    for (const message of body.messages) {
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (typeof part === "object" && part !== null) {
            expect(part).not.toHaveProperty("cache_control")
          }
        }
      }
    }
  })

  test("applies context cache for non-dashscope providers when explicitly enabled", async () => {
    providerConfig = {
      ...providerConfig,
      baseUrl: "https://api.example.com/v1",
      name: "custom",
      models: {
        "qwen-plus": {
          contextCache: true,
        },
      },
    } as ResolvedProviderConfig

    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [
          { content: "system prompt", role: "system" },
          { content: "hello", role: "user" },
        ],
        model: "custom/qwen-plus",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ content: unknown; role: string }>
    }
    const systemMessage = body.messages[0]
    expect(Array.isArray(systemMessage.content)).toBe(true)
    const systemPart = (
      systemMessage.content as Array<Record<string, unknown>>
    )[0]
    expect(systemPart.cache_control).toEqual({ type: "ephemeral" })
  })

  test("disables context cache for dashscope when contextCache is false", async () => {
    providerConfig = {
      ...providerConfig,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
      name: "dashscope",
      models: {
        "qwen-plus": {
          contextCache: false,
        },
      },
    } as ResolvedProviderConfig

    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        model: "dashscope/qwen-plus",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ content: unknown; role: string }>
    }
    for (const message of body.messages) {
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (typeof part === "object" && part !== null) {
            expect(part).not.toHaveProperty("cache_control")
          }
        }
      }
    }
  })
})

describe("dashscope preserve_thinking default on chat completions route", () => {
  test("defaults preserve_thinking to true for dashscope when not set", async () => {
    providerConfig = {
      ...providerConfig,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
      name: "dashscope",
      models: {
        "qwen-plus": {},
      },
    } as ResolvedProviderConfig

    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        model: "dashscope/qwen-plus",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.preserve_thinking).toBe(true)
  })

  test("keeps explicit preserve_thinking false from extraBody", async () => {
    providerConfig = {
      ...providerConfig,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
      name: "dashscope",
      models: {
        "qwen-plus": {
          extraBody: {
            preserve_thinking: false,
          },
        },
      },
    } as ResolvedProviderConfig

    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        model: "dashscope/qwen-plus",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.preserve_thinking).toBe(false)
  })

  test("keeps explicit preserve_thinking false from request", async () => {
    providerConfig = {
      ...providerConfig,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
      name: "dashscope",
      models: {
        "qwen-plus": {},
      },
    } as ResolvedProviderConfig

    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        model: "dashscope/qwen-plus",
        preserve_thinking: false,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.preserve_thinking).toBe(false)
  })

  test("does not set preserve_thinking for non-dashscope providers", async () => {
    providerConfig = {
      ...providerConfig,
      baseUrl: "https://api.example.com/v1",
      name: "custom",
      models: {
        "qwen-plus": {},
      },
    } as ResolvedProviderConfig

    const app = createApp()
    const response = await app.request("/v1/chat/completions", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        model: "custom/qwen-plus",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty("preserve_thinking")
  })
})
