import { afterEach, describe, expect, mock, test } from "bun:test"

import type { ResolvedProviderConfig } from "../src/lib/config"
import {
  forwardProviderChatCompletions,
  forwardProviderMessages,
  forwardProviderResponses,
} from "../src/services/providers/provider-proxy"

const originalFetch = globalThis.fetch

function parseJsonBody(body: unknown): unknown {
  if (typeof body !== "string") {
    throw new Error("Expected a JSON string request body")
  }
  return JSON.parse(body)
}

const createConfig = (
  type: ResolvedProviderConfig["type"],
  models?: ResolvedProviderConfig["models"],
): ResolvedProviderConfig => ({
  apiKey: "broker-token",
  authType: "llmapi-broker",
  baseUrl: "https://fe-26.qas.bing.net/sdf",
  configuredAuthType: "llmapi-broker",
  models,
  name: "llmapi",
  transport: "llmapi",
  type,
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("LLM API provider transport", () => {
  test("sends MAI Code to chat/completions with its compatible payload", async () => {
    const fetchMock = mock(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(Response.json({ ok: true })),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await forwardProviderChatCompletions(
      createConfig("openai-compatible"),
      {
        max_tokens: 32,
        messages: [{ role: "user", content: "Reply with model-ok" }],
        model: "dev-mai-code-1-flash",
        stop: ["END"],
        stream: true,
        stream_options: { include_usage: true },
      },
      new Headers(),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe("https://fe-26.qas.bing.net/sdf/chat/completions")
    const headers = new Headers(init?.headers)
    expect(headers.get("authorization")).toBe("Bearer broker-token")
    expect(headers.get("x-modeltype")).toBe("dev-mai-code-1-flash")
    expect(headers.get("x-taxonomy-experience")).toBe("AppCopilots")
    expect(parseJsonBody(init?.body)).toEqual({
      max_completion_tokens: 32,
      messages: [{ role: "user", content: "Reply with model-ok" }],
      stream: true,
    })
  })

  test("sends Anthropic models to messages with the default API version", async () => {
    const fetchMock = mock(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(Response.json({ ok: true })),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await forwardProviderMessages(
      createConfig("anthropic"),
      {
        max_tokens: 64,
        messages: [{ role: "user", content: "Hello" }],
        model: "dev-anthropic-claude-sonnet-4-5",
      },
      new Headers(),
    )

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe("https://fe-26.qas.bing.net/sdf/messages")
    const headers = new Headers(init?.headers)
    expect(headers.get("anthropic-version")).toBe("2023-06-01")
    expect(headers.get("x-modeltype")).toBe("dev-anthropic-claude-sonnet-4-5")
    expect(parseJsonBody(init?.body)).toEqual({
      max_tokens: 64,
      messages: [{ role: "user", content: "Hello" }],
    })
  })

  test("uses the responses path and configured api-version unchanged", async () => {
    const fetchMock = mock(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(Response.json({ ok: true })),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const model = "dev-gpt-56-reasoning-sol-oai-standard"

    await forwardProviderResponses(
      createConfig("openai-responses", {
        [model]: { apiVersion: "2026-07-01-preview" },
      }),
      {
        input: "Reply with model-ok",
        model,
      },
      new Headers(),
    )

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(
      "https://fe-26.qas.bing.net/sdf/responses?api-version=2026-07-01-preview",
    )
    expect(parseJsonBody(init?.body)).toEqual({
      input: "Reply with model-ok",
    })
  })
})

describe("Azure-backed provider payloads", () => {
  const createAzureConfig = (
    overrides: Partial<ResolvedProviderConfig> = {},
  ): ResolvedProviderConfig => ({
    apiKey: "azure-token",
    authType: "authorization",
    baseUrl: "https://cloudgpt-openai.azure-api.net/openai",
    configuredAuthType: "authorization",
    name: "cloudgpt",
    transport: "standard",
    type: "openai-compatible",
    ...overrides,
  })

  test("strips prompt_cache_key, which Azure rejects as an unknown argument", async () => {
    const fetchMock = mock(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(Response.json({ ok: true })),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await forwardProviderChatCompletions(
      createAzureConfig(),
      {
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "hello" }],
        prompt_cache_key: "session-1",
      },
      new Headers(),
    )

    const body = parseJsonBody(fetchMock.mock.calls[0]?.[1]?.body) as Record<
      string,
      unknown
    >
    expect(body).not.toHaveProperty("prompt_cache_key")
    expect(body.model).toBe("deepseek-v4-pro")
  })

  test("strips prompt_cache_key for azure-entra providers too", async () => {
    const fetchMock = mock(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(Response.json({ ok: true })),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await forwardProviderChatCompletions(
      createAzureConfig({
        authType: "azure-entra",
        name: "foundry",
        baseUrl: "https://example.openai.azure.com/openai",
      }),
      {
        model: "gpt-4.1",
        messages: [{ role: "user", content: "hello" }],
        prompt_cache_key: "session-1",
      },
      new Headers(),
    )

    const body = parseJsonBody(fetchMock.mock.calls[0]?.[1]?.body) as Record<
      string,
      unknown
    >
    expect(body).not.toHaveProperty("prompt_cache_key")
  })

  test("keeps prompt_cache_key for non-Azure providers", async () => {
    const fetchMock = mock(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(Response.json({ ok: true })),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await forwardProviderChatCompletions(
      createAzureConfig({
        name: "opencode-go",
        baseUrl: "https://opencode.ai/zen/go",
      }),
      {
        model: "qwen3-coder",
        messages: [{ role: "user", content: "hello" }],
        prompt_cache_key: "session-1",
      },
      new Headers(),
    )

    const body = parseJsonBody(fetchMock.mock.calls[0]?.[1]?.body) as Record<
      string,
      unknown
    >
    expect(body.prompt_cache_key).toBe("session-1")
  })
})
