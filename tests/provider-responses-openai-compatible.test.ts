import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Hono } from "hono"

import type { ResolvedProviderConfig } from "../src/lib/config"

const actualConfigModule = await import("../src/lib/config")
const actualTokenUsageModule = await import("../src/lib/token-usage")

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

const { responsesRoutes } = await import("../src/routes/responses/route")

const originalFetch = globalThis.fetch

const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "deepseek-chat",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "responses via chat",
            },
            logprobs: null,
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 3,
          total_tokens: 11,
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
  app.route("/v1/responses", responsesRoutes)
  return app
}

beforeEach(() => {
  providerConfig = {
    apiKey: "provider-key",
    authType: "authorization",
    baseUrl: "https://provider.example/openai",
    models: {
      "deepseek-chat": {},
    },
    name: "cloudgpt",
    pricingCurrency: "USD",
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

describe("provider responses backed by OpenAI-compatible chat completions", () => {
  test("translates non-streaming Responses requests to chat completions", async () => {
    const response = await createApp().request("/v1/responses", {
      body: JSON.stringify({
        model: "cloudgpt/deepseek-chat",
        instructions: "system prompt",
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hello" }],
          },
          {
            type: "function_call",
            call_id: "call-1",
            name: "lookup",
            arguments: '{"q":"one"}',
            status: "completed",
          },
          {
            type: "function_call",
            call_id: "call-2",
            name: "search",
            arguments: '{"q":"two"}',
            status: "completed",
          },
          {
            type: "message",
            role: "developer",
            content: "tool ordering note",
          },
          {
            type: "function_call_output",
            call_id: "call-1",
            output: "lookup result",
            status: "completed",
          },
          {
            type: "function_call_output",
            call_id: "call-2",
            output: "search result",
            status: "completed",
          },
        ],
        max_output_tokens: 128,
        tools: [
          {
            type: "function",
            name: "lookup",
            description: "Lookup data",
            parameters: { type: "object", properties: {} },
            strict: false,
          },
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
          {
            type: "web_search",
          },
        ],
        tool_choice: {
          type: "function",
          name: "lookup",
        },
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://provider.example/openai/v1/chat/completions")
    expect((init as RequestInit).headers).toEqual({
      "content-type": "application/json",
      accept: "application/json",
      authorization: "Bearer provider-key",
    })

    const upstreamBody = JSON.parse((init as RequestInit).body as string) as {
      max_tokens: number
      messages: Array<{
        role: string
        content: unknown
        tool_calls?: Array<{ id: string }>
        tool_call_id?: string
      }>
      model: string
      tool_choice: { function: { name: string }; type: string }
      tools: Array<{ function: { name: string }; type: string }>
    }
    expect(upstreamBody.model).toBe("deepseek-chat")
    expect(upstreamBody.max_tokens).toBe(128)
    expect(upstreamBody.tools[0]).toMatchObject({
      type: "function",
      function: { name: "lookup" },
    })
    expect(upstreamBody.tools[1]).toMatchObject({
      type: "function",
      function: { name: "mcp__fetch__fetch" },
    })
    expect(upstreamBody.tools).toHaveLength(2)
    expect(upstreamBody.tool_choice).toEqual({
      type: "function",
      function: { name: "lookup" },
    })
    expect(upstreamBody.messages).toMatchObject([
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call-1" }, { id: "call-2" }],
      },
      {
        role: "tool",
        tool_call_id: "call-1",
        content: "lookup result",
      },
      {
        role: "tool",
        tool_call_id: "call-2",
        content: "search result",
      },
      { role: "system", content: "tool ordering note" },
    ])

    expect(await response.json()).toMatchObject({
      id: "resp_chatcmpl-test",
      object: "response",
      model: "deepseek-chat",
      output_text: "responses via chat",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "responses via chat",
            },
          ],
        },
      ],
      usage: {
        input_tokens: 8,
        output_tokens: 3,
        total_tokens: 11,
      },
    })
  })

  test("uses max_completion_tokens for GPT-series Responses fallback to chat completions", async () => {
    providerConfig = {
      ...(providerConfig as ResolvedProviderConfig),
      models: {
        "gpt-5.2-codex": {},
      },
    }

    const response = await createApp().request("/v1/responses", {
      body: JSON.stringify({
        model: "cloudgpt/gpt-5.2-codex",
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hello" }],
          },
        ],
        max_output_tokens: 256,
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
    expect(upstreamBody.max_completion_tokens).toBe(256)
    expect(upstreamBody).not.toHaveProperty("max_tokens")
  })

  test("translates streaming chat chunks to Responses SSE events", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            [
              [
                "data: "
                  + JSON.stringify({
                    id: "chatcmpl-stream",
                    object: "chat.completion.chunk",
                    created: 0,
                    model: "deepseek-chat",
                    choices: [
                      {
                        index: 0,
                        delta: { role: "assistant" },
                        finish_reason: null,
                        logprobs: null,
                      },
                    ],
                  }),
              ].join("\n"),
              [
                "data: "
                  + JSON.stringify({
                    id: "chatcmpl-stream",
                    object: "chat.completion.chunk",
                    created: 0,
                    model: "deepseek-chat",
                    choices: [
                      {
                        index: 0,
                        delta: { content: "stream answer" },
                        finish_reason: null,
                        logprobs: null,
                      },
                    ],
                  }),
              ].join("\n"),
              [
                "data: "
                  + JSON.stringify({
                    id: "chatcmpl-stream",
                    object: "chat.completion.chunk",
                    created: 0,
                    model: "deepseek-chat",
                    choices: [
                      {
                        index: 0,
                        delta: {},
                        finish_reason: "stop",
                        logprobs: null,
                      },
                    ],
                    usage: {
                      prompt_tokens: 5,
                      completion_tokens: 2,
                      total_tokens: 7,
                    },
                  }),
              ].join("\n"),
              "data: [DONE]",
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

    const response = await createApp().request("/v1/responses", {
      body: JSON.stringify({
        model: "cloudgpt/deepseek-chat",
        input: "hello",
        stream: true,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const upstreamBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as { stream_options: { include_usage: boolean } }
    expect(upstreamBody.stream_options).toEqual({ include_usage: true })

    const text = await response.text()
    expect(text).toContain("event: response.created")
    expect(text).toContain("event: response.output_item.added")
    expect(text).toContain("event: response.output_text.delta")
    expect(text).toContain('"delta":"stream answer"')
    expect(text).toContain("event: response.output_text.done")
    expect(text).toContain("event: response.completed")
    expect(text).toContain('"output_text":"stream answer"')
  })

  test("surfaces mid-stream error data lines instead of fabricating completion", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            [
              "data: "
                + JSON.stringify({
                  id: "chatcmpl-stream",
                  object: "chat.completion.chunk",
                  created: 0,
                  model: "deepseek-chat",
                  choices: [
                    {
                      index: 0,
                      delta: { role: "assistant", content: "partial" },
                      finish_reason: null,
                      logprobs: null,
                    },
                  ],
                }),
              "data: "
                + JSON.stringify({
                  error: {
                    message: "rate limited mid-stream",
                    type: "rate_limit_error",
                  },
                }),
              "data: [DONE]",
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

    const response = await createApp().request("/v1/responses", {
      body: JSON.stringify({
        model: "cloudgpt/deepseek-chat",
        input: "hello",
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
    expect(text).toContain("rate limited mid-stream")
    expect(text).not.toContain("event: response.completed")
    expect(text).not.toContain("event: response.incomplete")
    // The error is surfaced as a terminal response.failed as well, so clients
    // that only render response.error see the reason.
    expect(text).toContain("event: response.failed")
  })

  test("surfaces a thrown mid-stream error as response.failed + error", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string | URL | Request, _init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                "data: "
                  + JSON.stringify({
                    id: "chatcmpl-stream",
                    object: "chat.completion.chunk",
                    created: 0,
                    model: "deepseek-chat",
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
            controller.error(new Error("upstream connection reset"))
          },
        })
        return Promise.resolve(
          new Response(body, {
            headers: { "content-type": "text/event-stream" },
          }),
        )
      },
    )

    const response = await createApp().request("/v1/responses", {
      body: JSON.stringify({
        model: "cloudgpt/deepseek-chat",
        input: "hello",
        stream: true,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain("event: response.failed")
    expect(text).toContain("event: error")
    expect(text).toContain("upstream connection reset")
  })

  test("empty upstream streams end in an error instead of a fabricated completion", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(["data: [DONE]", ""].join("\n\n"), {
            headers: {
              "content-type": "text/event-stream",
            },
          }),
        ),
    )

    const response = await createApp().request("/v1/responses", {
      body: JSON.stringify({
        model: "cloudgpt/deepseek-chat",
        input: "hello",
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
    expect(text).not.toContain("event: response.completed")
  })

  test("responses-only catalog models are forwarded natively, not via chat", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp_native",
              object: "response",
              created_at: 0,
              model: "gpt-5.4-pro-20260305",
              output: [],
              output_text: "",
              status: "completed",
              usage: null,
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
            { headers: { "content-type": "application/json" } },
          ),
        ),
    )

    const response = await createApp().request("/v1/responses", {
      body: JSON.stringify({
        model: "cloudgpt/gpt-5.4-pro-20260305",
        input: "hello",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe("https://provider.example/openai/v1/responses")
  })

  test("aliases CloudGPT GPT-5.6 collaboration tools and restores JSON calls", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string | URL | Request, init?: RequestInit) => {
        const upstreamBody = JSON.parse(init?.body as string) as {
          tools: Array<{ name: string; type: string }>
        }
        expect(upstreamBody.tools[0]).toMatchObject({
          name: "codex_collaboration",
          type: "namespace",
        })

        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp_gpt56",
              object: "response",
              created_at: 0,
              model: "gpt-5.6-sol-20260709",
              output: [
                {
                  type: "function_call",
                  call_id: "call-1",
                  name: "spawn_agent",
                  namespace: "codex_collaboration",
                  arguments: "{}",
                  status: "completed",
                },
              ],
              status: "completed",
              usage: null,
            }),
            { headers: { "content-type": "application/json" } },
          ),
        )
      },
    )

    const response = await createApp().request("/v1/responses", {
      body: JSON.stringify({
        model: "cloudgpt/gpt-5.6-sol-20260709",
        input: "delegate this",
        tools: [
          {
            type: "namespace",
            name: "collaboration",
            tools: [
              {
                type: "function",
                name: "spawn_agent",
                parameters: {},
                strict: false,
              },
            ],
          },
        ],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      output: Array<{ namespace?: string }>
    }
    expect(body.output[0].namespace).toBe("collaboration")
  })

  test("restores CloudGPT GPT-5.6 collaboration namespace in SSE", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            [
              "event: response.output_item.added",
              `data: ${JSON.stringify({
                type: "response.output_item.added",
                sequence_number: 1,
                output_index: 0,
                item: {
                  type: "function_call",
                  call_id: "call-1",
                  name: "spawn_agent",
                  namespace: "codex_collaboration",
                  arguments: "",
                  status: "in_progress",
                },
              })}`,
              "",
              "data: [DONE]",
              "",
            ].join("\n"),
            { headers: { "content-type": "text/event-stream" } },
          ),
        ),
    )

    const response = await createApp().request("/v1/responses", {
      body: JSON.stringify({
        model: "cloudgpt/gpt-5.6-sol-20260709",
        input: "delegate this",
        stream: true,
        tools: [
          {
            type: "namespace",
            name: "collaboration",
            tools: [],
          },
        ],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('"namespace":"collaboration"')
    expect(text).not.toContain('"namespace":"codex_collaboration"')
  })
})
