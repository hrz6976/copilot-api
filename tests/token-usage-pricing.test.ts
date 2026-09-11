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

  test("uses CloudGPT GPT-5.6 dated deployment pricing", () => {
    const expectedCosts = [
      { model: "gpt-5.6-sol-20260709", totalCostNanos: 96_000_000 },
      { model: "gpt-5.6-terra-20260709", totalCostNanos: 48_000_000 },
      { model: "gpt-5.6-luna-20260709", totalCostNanos: 19_200_000 },
    ]

    for (const { model, totalCostNanos } of expectedCosts) {
      const cost = resolveTokenUsageCost({
        cache_read_input_tokens: 2_000,
        input_tokens: 1_000,
        model,
        output_tokens: 3_000,
        providerName: "cloudgpt",
        source: "provider",
      })

      expect(cost).toEqual({
        currency: "USD",
        source: "builtin",
        total_cost_nanos: totalCostNanos,
      })
    }
  })
  test("uses CloudGPT Grok 4.6 pricing across its long-context band", () => {
    const belowBand = resolveTokenUsageCost({
      cache_read_input_tokens: 2_000,
      input_tokens: 1_000,
      model: "grok-4.6",
      output_tokens: 3_000,
      providerName: "cloudgpt",
      source: "provider",
    })

    expect(belowBand).toEqual({
      currency: "USD",
      source: "builtin",
      total_cost_nanos: 21_000_000,
    })

    const aboveBand = resolveTokenUsageCost({
      cache_read_input_tokens: 100_000,
      input_tokens: 300_000,
      model: "grok-4.6",
      output_tokens: 10_000,
      providerName: "cloudgpt",
      source: "provider",
    })

    expect(aboveBand).toEqual({
      currency: "USD",
      source: "builtin",
      total_cost_nanos: 1_420_000_000,
    })
  })

  test("uses CloudGPT GPT-6 Astra pricing including cache creation", () => {
    const cost = resolveTokenUsageCost({
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 2_000,
      input_tokens: 1_000,
      model: "gpt-6-astra-20260903",
      output_tokens: 3_000,
      providerName: "cloudgpt",
      source: "provider",
    })

    expect(cost).toEqual({
      currency: "USD",
      source: "builtin",
      total_cost_nanos: 168_250_000,
    })
  })

  test("uses CloudGPT Kimi K3 pricing", () => {
    const cost = resolveTokenUsageCost({
      cache_read_input_tokens: 2_000,
      input_tokens: 1_000,
      model: "Kimi-K3",
      output_tokens: 3_000,
      providerName: "cloudgpt",
      source: "provider",
    })

    expect(cost).toEqual({
      currency: "USD",
      source: "builtin",
      total_cost_nanos: 48_600_000,
    })
  })
})
