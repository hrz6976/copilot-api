import { describe, expect, test } from "bun:test"

import { resolveTokenUsageCost } from "../src/lib/token-usage/pricing"

describe("token usage pricing", () => {
  test("uses CloudGPT built-in cached pricing", () => {
    const cost = resolveTokenUsageCost({
      cache_read_input_tokens: 1_000,
      input_tokens: 1_000,
      model: "Kimi-K2.6",
      output_tokens: 1_000,
      providerName: "CLOUDGPT",
      source: "provider",
    })

    expect(cost).toEqual({
      currency: "USD",
      source: "builtin",
      total_cost_nanos: 5_110_000,
    })
  })

  test("uses CloudGPT Kimi K2.7 Code built-in cached pricing", () => {
    const cost = resolveTokenUsageCost({
      cache_read_input_tokens: 1_000,
      input_tokens: 1_000,
      model: "Kimi-K2.7-Code",
      output_tokens: 1_000,
      providerName: "CLOUDGPT",
      source: "provider",
    })

    expect(cost).toEqual({
      currency: "USD",
      source: "builtin",
      total_cost_nanos: 5_140_000,
    })
  })

  test("uses CloudGPT high-context pricing tier when input exceeds tier limit", () => {
    const cost = resolveTokenUsageCost({
      cache_read_input_tokens: 100_000,
      input_tokens: 300_000,
      model: "gpt-5.4-20260305",
      output_tokens: 10_000,
      providerName: "cloudgpt",
      source: "provider",
    })

    expect(cost).toEqual({
      currency: "USD",
      source: "builtin",
      total_cost_nanos: 1_775_000_000,
    })
  })
})
