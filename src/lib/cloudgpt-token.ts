import consola from "consola"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

export const CLOUDGPT_AZURE_TENANT_ID = "72f988bf-86f1-41af-91ab-2d7cd011db47"
export const CLOUDGPT_AZURE_SCOPE =
  "api://feb7b661-cac7-44a8-8dc1-163b63c23df2/.default"
export const CLOUDGPT_AZURE_LOGIN_COMMAND = `az login --tenant ${CLOUDGPT_AZURE_TENANT_ID}`

const CLOUDGPT_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000
const AZURE_CLI_TIMEOUT_MS = 30 * 1000
const execFileAsync = promisify(execFile)

export interface CloudGptAzureCliToken {
  accessToken: string
  expiresAtMs: number
  tenant?: string
  tokenType: string
}

type CloudGptAzureCliTokenCommand = () => Promise<CloudGptAzureCliToken>

let cachedToken: CloudGptAzureCliToken | null = null
let refreshPromise: Promise<CloudGptAzureCliToken> | null = null

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Azure CLI token response must be a JSON object")
  }
  return value as Record<string, unknown>
}

function parseExpiresOnSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function parseExpiresOnDatetime(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) {
    return null
  }

  const normalizedValue = value.trim().replace(" ", "T")
  const parsed = Date.parse(normalizedValue)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseCloudGptAzureCliTokenOutput(
  output: string,
): CloudGptAzureCliToken {
  const response = asRecord(JSON.parse(output) as unknown)
  const accessToken = response.accessToken
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new Error("Azure CLI token response did not include accessToken")
  }

  const tokenType =
    typeof response.tokenType === "string" && response.tokenType.trim() ?
      response.tokenType.trim()
    : "Bearer"
  if (tokenType.toLowerCase() !== "bearer") {
    throw new Error(`Azure CLI returned unsupported token type '${tokenType}'`)
  }

  const expiresOnSeconds = parseExpiresOnSeconds(response.expires_on)
  const expiresAtMs =
    expiresOnSeconds !== null ?
      Math.trunc(expiresOnSeconds * 1000)
    : parseExpiresOnDatetime(response.expiresOn)
  if (expiresAtMs === null || !Number.isFinite(expiresAtMs)) {
    throw new Error("Azure CLI token response did not include a valid expiry")
  }

  return {
    accessToken: accessToken.trim(),
    expiresAtMs,
    tenant:
      typeof response.tenant === "string" && response.tenant.trim() ?
        response.tenant.trim()
      : undefined,
    tokenType,
  }
}

export function isCloudGptAzureCliTokenFresh(
  token: CloudGptAzureCliToken | null,
  nowMs = Date.now(),
  refreshWindowMs = CLOUDGPT_TOKEN_REFRESH_WINDOW_MS,
): boolean {
  return Boolean(token && token.expiresAtMs - nowMs > refreshWindowMs)
}

async function runAzureCliTokenCommand(): Promise<CloudGptAzureCliToken> {
  const { stdout } = await execFileAsync(
    "az",
    [
      "account",
      "get-access-token",
      "--tenant",
      CLOUDGPT_AZURE_TENANT_ID,
      "--scope",
      CLOUDGPT_AZURE_SCOPE,
      "-o",
      "json",
    ],
    {
      encoding: "utf8",
      timeout: AZURE_CLI_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  )

  return parseCloudGptAzureCliTokenOutput(String(stdout))
}

async function refreshCloudGptAzureCliToken(
  command: CloudGptAzureCliTokenCommand,
): Promise<CloudGptAzureCliToken> {
  refreshPromise ??= command()
    .then((token) => {
      cachedToken = token
      return token
    })
    .finally(() => {
      refreshPromise = null
    })

  return await refreshPromise
}

export async function getCloudGptAzureCliAccessToken(
  options: {
    command?: CloudGptAzureCliTokenCommand
    nowMs?: number
    refreshWindowMs?: number
  } = {},
): Promise<string> {
  const nowMs = options.nowMs ?? Date.now()
  const refreshWindowMs =
    options.refreshWindowMs ?? CLOUDGPT_TOKEN_REFRESH_WINDOW_MS
  const currentToken = cachedToken
  if (
    currentToken
    && isCloudGptAzureCliTokenFresh(currentToken, nowMs, refreshWindowMs)
  ) {
    return currentToken.accessToken
  }

  try {
    const token = await refreshCloudGptAzureCliToken(
      options.command ?? runAzureCliTokenCommand,
    )
    return token.accessToken
  } catch (error) {
    const fallbackToken: CloudGptAzureCliToken | null = cachedToken
    if (fallbackToken && fallbackToken.expiresAtMs > nowMs) {
      consola.warn(
        "Failed to refresh CloudGPT Azure CLI token; using cached token until it expires.",
        getErrorMessage(error),
      )
      return fallbackToken.accessToken
    }

    throw new Error(
      `Failed to acquire CloudGPT Azure CLI token. Run \`az login --tenant ${CLOUDGPT_AZURE_TENANT_ID}\` and try again. ${getErrorMessage(error)}`,
    )
  }
}

export function resetCloudGptAzureCliTokenCache(): void {
  cachedToken = null
  refreshPromise = null
}
