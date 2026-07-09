import { describe, expect, test } from "bun:test"

import {
  resolveEffectiveProviderConfig,
  resolveProviderAuthType,
  type ResolvedProviderConfig,
} from "~/lib/config"

import { buildProviderUpstreamHeaders } from "../src/services/providers/provider-proxy"

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
