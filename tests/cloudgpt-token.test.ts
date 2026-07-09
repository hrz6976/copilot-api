import { afterEach, describe, expect, test } from "bun:test"

import {
  getCloudGptAzureCliAccessToken,
  isCloudGptAzureCliTokenFresh,
  parseCloudGptAzureCliTokenOutput,
  resetCloudGptAzureCliTokenCache,
} from "~/lib/cloudgpt-token"

afterEach(() => {
  resetCloudGptAzureCliTokenCache()
})

describe("CloudGPT Azure CLI token handling", () => {
  test("parses Azure CLI token output without reading token internals", () => {
    const token = parseCloudGptAzureCliTokenOutput(
      JSON.stringify({
        accessToken: " cloudgpt-access-token ",
        expires_on: 1783398547,
        tenant: "72f988bf-86f1-41af-91ab-2d7cd011db47",
        tokenType: "Bearer",
      }),
    )

    expect(token).toEqual({
      accessToken: "cloudgpt-access-token",
      expiresAtMs: 1783398547000,
      tenant: "72f988bf-86f1-41af-91ab-2d7cd011db47",
      tokenType: "Bearer",
    })
  })

  test("rejects token output without an access token", () => {
    expect(() =>
      parseCloudGptAzureCliTokenOutput(
        JSON.stringify({
          expires_on: 1783398547,
          tokenType: "Bearer",
        }),
      ),
    ).toThrow("Azure CLI token response did not include accessToken")
  })

  test("treats tokens inside the refresh window as stale", () => {
    expect(
      isCloudGptAzureCliTokenFresh(
        {
          accessToken: "token",
          expiresAtMs: 10 * 60 * 1000,
          tokenType: "Bearer",
        },
        0,
        5 * 60 * 1000,
      ),
    ).toBe(true)

    expect(
      isCloudGptAzureCliTokenFresh(
        {
          accessToken: "token",
          expiresAtMs: 4 * 60 * 1000,
          tokenType: "Bearer",
        },
        0,
        5 * 60 * 1000,
      ),
    ).toBe(false)
  })

  test("caches fresh tokens", async () => {
    let calls = 0
    const command = () => {
      calls += 1
      return Promise.resolve({
        accessToken: `token-${calls}`,
        expiresAtMs: 60 * 60 * 1000,
        tokenType: "Bearer",
      })
    }

    expect(await getCloudGptAzureCliAccessToken({ command, nowMs: 0 })).toBe(
      "token-1",
    )
    expect(
      await getCloudGptAzureCliAccessToken({ command, nowMs: 1_000 }),
    ).toBe("token-1")
    expect(calls).toBe(1)
  })

  test("refreshes stale tokens", async () => {
    let calls = 0
    const command = () => {
      calls += 1
      return Promise.resolve({
        accessToken: `token-${calls}`,
        expiresAtMs: calls === 1 ? 4 * 60 * 1000 : 60 * 60 * 1000,
        tokenType: "Bearer",
      })
    }

    expect(await getCloudGptAzureCliAccessToken({ command, nowMs: 0 })).toBe(
      "token-1",
    )
    // Within the min refresh interval the still-valid near-expiry token is
    // reused instead of spawning az again
    expect(await getCloudGptAzureCliAccessToken({ command, nowMs: 1000 })).toBe(
      "token-1",
    )
    expect(calls).toBe(1)
    // Once the interval has passed, the stale token is refreshed
    expect(
      await getCloudGptAzureCliAccessToken({ command, nowMs: 31_000 }),
    ).toBe("token-2")
    expect(calls).toBe(2)
  })

  test("shares a single refresh across concurrent callers", async () => {
    let calls = 0
    const command = async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return {
        accessToken: "shared-token",
        expiresAtMs: 60 * 60 * 1000,
        tokenType: "Bearer",
      }
    }

    const [firstToken, secondToken] = await Promise.all([
      getCloudGptAzureCliAccessToken({ command, nowMs: 0 }),
      getCloudGptAzureCliAccessToken({ command, nowMs: 0 }),
    ])

    expect(firstToken).toBe("shared-token")
    expect(secondToken).toBe("shared-token")
    expect(calls).toBe(1)
  })

  test("uses still-valid cached token when refresh fails", async () => {
    await getCloudGptAzureCliAccessToken({
      command: () =>
        Promise.resolve({
          accessToken: "cached-token",
          expiresAtMs: 10 * 60 * 1000,
          tokenType: "Bearer",
        }),
      nowMs: 0,
    })

    expect(
      await getCloudGptAzureCliAccessToken({
        command: () => Promise.reject(new Error("az unavailable")),
        nowMs: 6 * 60 * 1000,
      }),
    ).toBe("cached-token")
  })
})
