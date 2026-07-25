import { describe, expect, mock, test } from "bun:test"
import type { AccountInfo, AuthenticationResult } from "@azure/msal-node"

import type { LlmApiAuthClient } from "../src/lib/llmapi-token"
import {
  assertLlmApiBrokerPlatformSupported,
  getLlmApiAccessToken,
  isLlmApiBrokerPlatformSupported,
  loginLlmApi,
} from "../src/lib/llmapi-token"

const account = (username: string): AccountInfo => ({
  environment: "login.microsoftonline.com",
  homeAccountId: `home-${username}`,
  localAccountId: `local-${username}`,
  tenantId: "tenant",
  username,
})

const result = (
  accessToken: string,
  resultAccount: AccountInfo | null = account("user@example.com"),
): AuthenticationResult =>
  ({
    accessToken,
    account: resultAccount,
  }) as AuthenticationResult

describe("LLM API token acquisition", () => {
  test("supports only Windows and macOS broker platforms", () => {
    expect(isLlmApiBrokerPlatformSupported("win32")).toBe(true)
    expect(isLlmApiBrokerPlatformSupported("darwin")).toBe(true)
    expect(isLlmApiBrokerPlatformSupported("linux")).toBe(false)
    expect(() => assertLlmApiBrokerPlatformSupported("linux")).toThrow(
      "Use Windows or macOS",
    )
  })

  test("requires an explicit broker login when no account exists", async () => {
    const client = {
      acquireTokenInteractive: mock(),
      acquireTokenSilent: mock(),
      getAllAccounts: mock(() => Promise.resolve([])),
    } as unknown as LlmApiAuthClient

    let error: unknown
    try {
      await getLlmApiAccessToken({ client })
    } catch (caughtError) {
      error = caughtError
    }

    expect(error).toBeInstanceOf(Error)
    expect(error instanceof Error ? error.message : "").toContain(
      "copilot-api auth login --provider llmapi",
    )
  })

  test("deduplicates concurrent silent token requests", async () => {
    let resolveToken!: (value: AuthenticationResult) => void
    const pendingToken = new Promise<AuthenticationResult>((resolve) => {
      resolveToken = resolve
    })
    const acquireTokenSilent = mock(async () => await pendingToken)
    const client = {
      acquireTokenInteractive: mock(),
      acquireTokenSilent,
      getAllAccounts: mock(() =>
        Promise.resolve([account("user@example.com")]),
      ),
    } as unknown as LlmApiAuthClient

    const first = getLlmApiAccessToken({ client })
    const second = getLlmApiAccessToken({ client })
    resolveToken(result("silent-token"))

    expect(await Promise.all([first, second])).toEqual([
      "silent-token",
      "silent-token",
    ])
    expect(acquireTokenSilent).toHaveBeenCalledTimes(1)
  })

  test("tries another broker account after a silent failure", async () => {
    const firstAccount = account("first@example.com")
    const secondAccount = account("second@example.com")
    const acquireTokenSilent = mock((request: { account: AccountInfo }) => {
      if (request.account.username === firstAccount.username) {
        return Promise.reject(new Error("expired"))
      }
      return Promise.resolve(result("second-token", secondAccount))
    })
    const client = {
      acquireTokenInteractive: mock(),
      acquireTokenSilent,
      getAllAccounts: mock(() =>
        Promise.resolve([firstAccount, secondAccount]),
      ),
    } as unknown as LlmApiAuthClient

    expect(await getLlmApiAccessToken({ client })).toBe("second-token")
    expect(acquireTokenSilent).toHaveBeenCalledTimes(2)
  })

  test("reuses an entitled broker account without opening account selection", async () => {
    const existingAccount = account("existing@example.com")
    const acquireTokenInteractive = mock()
    const acquireTokenSilent = mock(() =>
      Promise.resolve(result("silent-token", existingAccount)),
    )
    const client = {
      acquireTokenInteractive,
      acquireTokenSilent,
      getAllAccounts: mock(() => Promise.resolve([existingAccount])),
    } as unknown as LlmApiAuthClient

    expect(await loginLlmApi({ client })).toEqual({
      account: existingAccount,
      accessToken: "silent-token",
    })
    expect(acquireTokenInteractive).not.toHaveBeenCalled()
  })

  test("uses interactive account selection when existing accounts fail", async () => {
    const selectedAccount = account("selected@example.com")
    const acquireTokenInteractive = mock(
      (_request: Parameters<LlmApiAuthClient["acquireTokenInteractive"]>[0]) =>
        Promise.resolve(result("interactive-token", selectedAccount)),
    )
    const acquireTokenSilent = mock(() =>
      Promise.resolve(result("verified-token", selectedAccount)),
    )
    const client = {
      acquireTokenInteractive,
      acquireTokenSilent,
      getAllAccounts: mock(() => Promise.resolve([])),
    } as unknown as LlmApiAuthClient

    const login = await loginLlmApi({ client })

    expect(login).toEqual({
      account: selectedAccount,
      accessToken: "verified-token",
    })
    const request = acquireTokenInteractive.mock.calls[0]?.[0]
    expect(typeof request?.openBrowser).toBe("function")
    expect(request?.prompt).toBe("select_account")
    expect(request?.scopes).toEqual([
      "https://substrate.office.com/llmapi/LLMAPI.dev",
    ])
    expect(acquireTokenSilent).toHaveBeenCalledWith({
      account: selectedAccount,
      scopes: ["https://substrate.office.com/llmapi/LLMAPI.dev"],
    })
  })

  test("rejects login when the selected account cannot refresh silently", async () => {
    const selectedAccount = account("selected@example.com")
    const client = {
      acquireTokenInteractive: mock(() =>
        Promise.resolve(result("interactive-token", selectedAccount)),
      ),
      acquireTokenSilent: mock(() =>
        Promise.reject(new Error("broker cache unavailable")),
      ),
      getAllAccounts: mock(() => Promise.resolve([])),
    } as unknown as LlmApiAuthClient

    let error: unknown
    try {
      await loginLlmApi({ client })
    } catch (caughtError) {
      error = caughtError
    }

    expect(error).toBeInstanceOf(Error)
    expect(error instanceof Error ? error.message : "").toContain(
      "No provider configuration was saved",
    )
  })
})
