import type {
  AccountInfo,
  AuthenticationResult,
  SilentFlowRequest,
} from "@azure/msal-node"

import { PublicClientApplication } from "@azure/msal-node"

export const LLMAPI_CLIENT_ID = "68df66a4-cad9-4bfd-872b-c6ddde00d6b2"
export const LLMAPI_TENANT_ID = "72f988bf-86f1-41af-91ab-2d7cd011db47"
export const LLMAPI_SCOPES = ["https://substrate.office.com/llmapi/LLMAPI.dev"]

export interface LlmApiAuthClient {
  acquireTokenInteractive(request: {
    openBrowser: (url: string) => Promise<void>
    prompt?: string
    scopes: string[]
  }): Promise<AuthenticationResult>
  acquireTokenSilent(request: SilentFlowRequest): Promise<AuthenticationResult>
  getAllAccounts(): Promise<AccountInfo[]>
}

interface LlmApiTokenOptions {
  client?: LlmApiAuthClient
}

const LLMAPI_BROKER_PLATFORMS: NodeJS.Platform[] = ["darwin", "win32"]

let authClientRequest: Promise<LlmApiAuthClient> | undefined
let tokenRequest: Promise<string> | undefined

export function isLlmApiBrokerPlatformSupported(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return LLMAPI_BROKER_PLATFORMS.includes(platform)
}

export function assertLlmApiBrokerPlatformSupported(
  platform: NodeJS.Platform = process.platform,
): void {
  if (isLlmApiBrokerPlatformSupported(platform)) {
    return
  }

  throw new Error(
    `Microsoft LLM API broker authentication is not supported on ${platform}. Use Windows or macOS.`,
  )
}

async function createAuthClient(): Promise<LlmApiAuthClient> {
  assertLlmApiBrokerPlatformSupported()

  let NativeBrokerPlugin: typeof import("@azure/msal-node-extensions").NativeBrokerPlugin
  try {
    const brokerModule = await import("@azure/msal-node-extensions")
    NativeBrokerPlugin = brokerModule.NativeBrokerPlugin
  } catch (error) {
    throw new Error(
      "Unable to load the native authentication broker. Reinstall dependencies and ensure @azure/msal-node-runtime is trusted when using Bun.",
      { cause: error },
    )
  }
  const nativeBrokerPlugin = new NativeBrokerPlugin()
  if (!nativeBrokerPlugin.isBrokerAvailable) {
    throw new Error(
      "The native authentication broker is unavailable. Ensure @azure/msal-node-runtime is installed (and trusted when using Bun), then retry on Windows or macOS.",
    )
  }

  return new PublicClientApplication({
    auth: {
      authority: `https://login.microsoftonline.com/${LLMAPI_TENANT_ID}`,
      clientId: LLMAPI_CLIENT_ID,
    },
    broker: {
      nativeBrokerPlugin,
    },
  })
}

const getAuthClient = (): Promise<LlmApiAuthClient> =>
  (authClientRequest ??= createAuthClient())

function requireAccessToken(result: AuthenticationResult | null): string {
  const accessToken = result?.accessToken.trim()
  if (!accessToken) {
    throw new Error("LLM API authentication returned an empty access token.")
  }
  return accessToken
}

async function acquireSilentToken(client: LlmApiAuthClient): Promise<string> {
  const accounts = await client.getAllAccounts()
  if (accounts.length === 0) {
    throw new Error(
      "LLM API credentials not found. Run `copilot-api auth login --provider llmapi` first.",
    )
  }

  let lastError: unknown
  for (const account of accounts) {
    try {
      const result = await client.acquireTokenSilent({
        account,
        scopes: LLMAPI_SCOPES,
      })
      return requireAccessToken(result)
    } catch (error) {
      lastError = error
    }
  }

  const reason =
    lastError instanceof Error && lastError.message ?
      ` (${lastError.message})`
    : ""
  throw new Error(
    `Unable to refresh the LLM API token silently${reason}. Run \`copilot-api auth login --provider llmapi\` again.`,
  )
}

export async function getLlmApiAccessToken(
  options: LlmApiTokenOptions = {},
): Promise<string> {
  tokenRequest ??= (
    options.client ?
      acquireSilentToken(options.client)
    : getAuthClient().then(acquireSilentToken)).finally(() => {
    tokenRequest = undefined
  })
  return await tokenRequest
}

export async function loginLlmApi(
  options: LlmApiTokenOptions = {},
): Promise<{ account: AccountInfo; accessToken: string }> {
  const client = options.client ?? (await getAuthClient())
  const result = await client.acquireTokenInteractive({
    openBrowser: () => Promise.resolve(),
    prompt: "select_account",
    scopes: LLMAPI_SCOPES,
  })
  requireAccessToken(result)
  if (!result.account) {
    throw new Error("LLM API authentication did not return an account.")
  }

  let verifiedAccessToken: string
  try {
    const verifiedResult = await client.acquireTokenSilent({
      account: result.account,
      scopes: LLMAPI_SCOPES,
    })
    verifiedAccessToken = requireAccessToken(verifiedResult)
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? ` (${error.message})` : ""
    throw new Error(
      `Microsoft LLM API sign-in completed, but the broker could not reuse the selected account silently${reason}. No provider configuration was saved.`,
    )
  }

  return {
    account: result.account,
    accessToken: verifiedAccessToken,
  }
}
