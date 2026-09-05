import { describe, expect, test } from "bun:test"

import {
  resolveEffectiveProviderConfig,
  resolveProviderAuthType,
  type ResolvedProviderConfig,
} from "~/lib/config"

import { buildProviderUpstreamHeaders } from "~/services/providers/provider-proxy"

function createProviderConfig(
  overrides: Partial<ResolvedProviderConfig> = {},
): ResolvedProviderConfig {
  return {
    name: "custom",
    type: "anthropic",
    baseUrl: "https://example.com",
    apiKey: "provider-key",
    authType: "x-api-key",
    ...overrides,
  }
}

describe("buildProviderUpstreamHeaders", () => {
  test("uses x-api-key auth by default", () => {
    const headers = buildProviderUpstreamHeaders(
      createProviderConfig(),
      new Headers({
        accept: "application/json",
        "anthropic-version": "2023-06-01",
      }),
    )

    expect(headers).toEqual({
      "content-type": "application/json",
      accept: "application/json",
      "x-api-key": "provider-key",
      "anthropic-version": "2023-06-01",
    })
  })

  test("uses Authorization bearer auth when configured", () => {
    const headers = buildProviderUpstreamHeaders(
      createProviderConfig({ authType: "authorization" }),
      new Headers({
        accept: "application/json",
        "user-agent": "test-client",
      }),
    )

    expect(headers).toEqual({
      "content-type": "application/json",
      accept: "application/json",
      authorization: "Bearer provider-key",
      "user-agent": "test-client",
    })
  })

  test("does not forward Anthropic-only headers to OpenAI-compatible providers", () => {
    const headers = buildProviderUpstreamHeaders(
      createProviderConfig({
        authType: "authorization",
        type: "openai-compatible",
      }),
      new Headers({
        accept: "application/json",
        "anthropic-version": "2023-06-01",
      }),
    )

    expect(headers).toEqual({
      "content-type": "application/json",
      accept: "application/json",
      authorization: "Bearer provider-key",
    })
  })
})

describe("resolveProviderAuthType", () => {
  test("falls back to OpenAI-compatible default for invalid authType", () => {
    expect(
      resolveProviderAuthType("dash", "invalid-auth-type", "openai-compatible"),
    ).toBe("authorization")
  })

  test("falls back to Anthropic default for invalid authType", () => {
    expect(
      resolveProviderAuthType("custom", "invalid-auth-type", "anthropic"),
    ).toBe("x-api-key")
  })

  test("falls back for non-codex oauth2 providers", () => {
    expect(
      resolveProviderAuthType("custom", "oauth2", "openai-responses"),
    ).toBe("authorization")
  })

  test("allows azure-cli auth for CloudGPT", () => {
    expect(
      resolveProviderAuthType("cloudgpt", "azure-cli", "openai-compatible"),
    ).toBe("azure-cli")
  })

  test("falls back for non-CloudGPT azure-cli providers", () => {
    expect(
      resolveProviderAuthType("custom", "azure-cli", "openai-compatible"),
    ).toBe("authorization")
  })

  test("allows native broker auth only for LLM API", () => {
    expect(
      resolveProviderAuthType("llmapi", "llmapi-broker", "openai-compatible"),
    ).toBe("llmapi-broker")
    expect(
      resolveProviderAuthType("custom", "llmapi-broker", "openai-compatible"),
    ).toBe("authorization")
  })
})

describe("resolveEffectiveProviderConfig", () => {
  test("recomputes authType when a model override changes the type", () => {
    const effective = resolveEffectiveProviderConfig(
      createProviderConfig({
        type: "anthropic",
        authType: "x-api-key",
        models: { "gpt-x": { type: "openai-compatible" } },
      }),
      "gpt-x",
    )

    expect(effective.type).toBe("openai-compatible")
    expect(effective.authType).toBe("authorization")
  })

  test("keeps an explicitly configured authType across type overrides", () => {
    const effective = resolveEffectiveProviderConfig(
      createProviderConfig({
        type: "openai-compatible",
        authType: "authorization",
        configuredAuthType: "authorization",
        models: { "claude-x": { type: "anthropic" } },
      }),
      "claude-x",
    )

    expect(effective.type).toBe("anthropic")
    expect(effective.authType).toBe("authorization")
  })

  test("returns the same config when no override applies", () => {
    const providerConfig = createProviderConfig()
    expect(resolveEffectiveProviderConfig(providerConfig, "unknown")).toBe(
      providerConfig,
    )
  })
})

describe("resolveEffectiveProviderConfig cloudgpt catalog routing", () => {
  const cloudgptConfig = (
    overrides: Partial<ResolvedProviderConfig> = {},
  ): ResolvedProviderConfig =>
    createProviderConfig({
      name: "cloudgpt",
      type: "openai-compatible",
      authType: "authorization",
      ...overrides,
    })

  test("responses-only models resolve to openai-responses automatically", () => {
    const effective = resolveEffectiveProviderConfig(
      cloudgptConfig(),
      "gpt-5.4-pro-20260305",
    )
    expect(effective.type).toBe("openai-responses")
  })

  test("chat-capable models follow the caller's protocol preference", () => {
    const chatFirst = resolveEffectiveProviderConfig(
      cloudgptConfig(),
      "gpt-4.1-mini-20250414",
    )
    expect(chatFirst.type).toBe("openai-compatible")

    const responsesFirst = resolveEffectiveProviderConfig(
      cloudgptConfig(),
      "gpt-4.1-mini-20250414",
      ["openai-responses", "openai-compatible"],
    )
    expect(responsesFirst.type).toBe("openai-responses")
  })

  test("chat-only models stay openai-compatible even when responses is preferred", () => {
    const effective = resolveEffectiveProviderConfig(
      cloudgptConfig(),
      "DeepSeek-V3.2",
      ["openai-responses", "openai-compatible"],
    )
    expect(effective.type).toBe("openai-compatible")
  })

  test("explicit per-model config overrides the catalog", () => {
    const effective = resolveEffectiveProviderConfig(
      cloudgptConfig({
        models: { "gpt-4.1-mini-20250414": { type: "openai-responses" } },
      }),
      "gpt-4.1-mini-20250414",
    )
    expect(effective.type).toBe("openai-responses")
  })

  test("non-chat and unknown models fall back to the provider type", () => {
    expect(
      resolveEffectiveProviderConfig(cloudgptConfig(), "text-embedding-3-large")
        .type,
    ).toBe("openai-compatible")
    expect(
      resolveEffectiveProviderConfig(cloudgptConfig(), "no-such-model").type,
    ).toBe("openai-compatible")
  })
})
