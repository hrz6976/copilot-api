import consola from "consola"
import { randomUUID } from "node:crypto"
import {
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from "undici"

import {
  getUpstreamTransportConfig,
  normalizeProviderBaseUrl,
  type ResolvedProviderConfig,
} from "~/lib/config"
import { getGrokBuildVersion } from "~/lib/grok-build"
import { XAI_API_BASE_URL } from "~/lib/oauth/xai"
import { requestContext } from "~/lib/request-context"
import { createTimeoutDispatcher } from "~/lib/timeout-dispatcher"
import type { AnthropicMessagesPayload } from "~/lib/types/anthropic"
import type { ChatCompletionsPayload } from "~/lib/types/chat-completions"
import type { ResponsesPayload } from "~/lib/types/responses"
import type { GoogleModelsResponse } from "~/lib/types/google"
import { parseUserIdMetadata } from "~/lib/utils"
import { fetchUpstreamWithLifecycle } from "~/services/upstream-http"

import { getLlmApiModel } from "~/services/llmapi/get-models"

const SHARED_FORWARDABLE_HEADERS = ["accept", "user-agent"] as const

const ANTHROPIC_FORWARDABLE_HEADERS = [
  "anthropic-version",
  "anthropic-beta",
] as const

const STRIPPED_RESPONSE_HEADERS = [
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const

export function resolveProviderEndpointUrl(
  providerConfig: ResolvedProviderConfig,
  endpoint: string,
): string {
  if (providerConfig.name === OPENCODE_GO_PROVIDER_NAME) {
    const base = normalizeProviderBaseUrl(providerConfig.baseUrl)
    const apiBase = /\/v\d+(?:alpha|beta)?$/u.test(base) ? base : `${base}/v1`
    return `${apiBase}/${endpoint}`
  }
  if (providerConfig.type === "google") {
    const base = providerConfig.baseUrl.replace(/\/+$/u, "")
    const apiBase =
      /\/v\d+(?:alpha|beta)?$/u.test(base) ? base : `${base}/v1beta`
    return `${apiBase}/${endpoint}`
  }
  const apiBaseUrl =
    providerConfig.modelsDevProviderId ?
      providerConfig.baseUrl.replace(/\/(?:chat\/completions|responses)$/u, "")
    : `${providerConfig.baseUrl}/v1`
  return `${apiBaseUrl}/${endpoint}`
}

export function buildProviderUpstreamHeaders(
  providerConfig: ResolvedProviderConfig,
  requestHeaders: Headers,
  model?: string,
): Record<string, string> {
  const authHeaders: Record<string, string> = {}
  if (
    providerConfig.authType === "x-api-key"
    || providerConfig.authType === "x-goog-api-key"
  ) {
    authHeaders[providerConfig.authType] = providerConfig.apiKey
  } else {
    authHeaders.authorization = `Bearer ${providerConfig.apiKey}`
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    ...authHeaders,
  }

  if (providerConfig.transport === "llmapi") {
    if (!model) {
      throw new Error("LLM API requests require an exact upstream model ID.")
    }

    headers["x-modeltype"] = model
    headers["x-taxonomy-experience"] = "AppCopilots"
    headers["x-taxonomy-agent"] = "LLMAPISampleApp"
    headers["x-taxonomy-inferencestep"] = "InferenceTest"
    headers["x-taxonomy-traffictype"] = "Test"
  }

  for (const headerName of SHARED_FORWARDABLE_HEADERS) {
    const headerValue = requestHeaders.get(headerName)
    if (headerValue) {
      headers[headerName] = headerValue
    }
  }

  if (providerConfig.type !== "anthropic") {
    return headers
  }

  if (providerConfig.modelsDevProviderId) {
    headers["anthropic-version"] = "2023-06-01"
  }

  for (const headerName of ANTHROPIC_FORWARDABLE_HEADERS) {
    const headerValue = requestHeaders.get(headerName)
    if (headerValue) {
      headers[headerName] = headerValue
    }
  }

  if (providerConfig.transport === "llmapi" && !headers["anthropic-version"]) {
    headers["anthropic-version"] = "2023-06-01"
  }

  return headers
}

function buildProviderUrl(
  providerConfig: ResolvedProviderConfig,
  endpoint: "chat/completions" | "messages" | "responses",
  model: string,
): string {
  const url =
    providerConfig.transport === "llmapi" ?
      `${providerConfig.baseUrl}/${endpoint}`
    : resolveProviderEndpointUrl(providerConfig, endpoint)
  const apiVersion = providerConfig.models?.[model]?.apiVersion?.trim()
  return apiVersion ?
      `${url}?api-version=${encodeURIComponent(apiVersion)}`
    : url
}

/**
 * Azure OpenAI rejects unknown request arguments outright, so upstream-only
 * fields (currently prompt_cache_key, used for Copilot session affinity) must
 * be removed before forwarding. The field is still read from the original
 * payload for session headers, so opencode-go affinity is unaffected.
 */
const rejectsUnknownRequestArguments = (
  providerConfig: ResolvedProviderConfig,
): boolean =>
  providerConfig.name === "cloudgpt"
  || providerConfig.authType === "azure-entra"

function buildProviderPayload<T extends { model: string }>(
  providerConfig: ResolvedProviderConfig,
  payload: T,
): Omit<T, "model"> | T {
  if (providerConfig.transport !== "llmapi") {
    if (
      rejectsUnknownRequestArguments(providerConfig)
      && "prompt_cache_key" in payload
    ) {
      const { prompt_cache_key: _promptCacheKey, ...rest } = payload as T & {
        prompt_cache_key?: string
      }
      return rest as T
    }
    return payload
  }

  const upstreamPayload = {
    ...payload,
  } as Record<string, unknown>
  delete upstreamPayload.model

  const compatibility = getLlmApiModel(payload.model)?.compatibility
  if (
    compatibility?.maxTokensParam === "max_completion_tokens"
    && upstreamPayload.max_completion_tokens == null
    && upstreamPayload.max_tokens != null
  ) {
    upstreamPayload.max_completion_tokens = upstreamPayload.max_tokens
  }
  if (compatibility?.maxTokensParam === "max_completion_tokens") {
    delete upstreamPayload.max_tokens
  }
  for (const parameter of compatibility?.unsupportedParams ?? []) {
    delete upstreamPayload[parameter]
  }

  if (providerConfig.type === "openai-compatible") {
    delete upstreamPayload.stream_options
  }

  return upstreamPayload as Omit<T, "model">
}

const OPENCODE_GO_PROVIDER_NAME = "opencode-go"
const OPENCODE_SESSION_HEADER = "x-opencode-session"

export const resolveOpencodeMessagesSession = (
  payload: AnthropicMessagesPayload,
): string | undefined => {
  const store = requestContext.getStore()
  // Keep sibling subagents on the root session so opencode-go routes them to the
  // same prompt cache group, matching the chat completions/responses flows.
  const rootSessionId = store?.rootSessionId?.trim()
  if (rootSessionId) {
    return rootSessionId
  }

  const sessionAffinity = store?.sessionAffinity?.trim()
  if (sessionAffinity) {
    return sessionAffinity
  }

  const userId = payload.metadata?.user_id
  if (!userId?.trim()) {
    return undefined
  }

  const { sessionId } = parseUserIdMetadata(userId)
  return sessionId ?? userId
}

export const applyOpencodeSessionHeader = (
  providerConfig: ResolvedProviderConfig,
  headers: Record<string, string>,
  session: string | undefined,
): void => {
  if (providerConfig.name !== OPENCODE_GO_PROVIDER_NAME || !session) {
    return
  }
  headers[OPENCODE_SESSION_HEADER] = session
}

async function applyXaiGrokBuildHeaders(
  providerConfig: ResolvedProviderConfig,
  headers: Record<string, string>,
  payload: ResponsesPayload,
): Promise<void> {
  if (
    providerConfig.name !== "xai"
    || providerConfig.authType !== "oauth2"
    || new URL(providerConfig.baseUrl).origin !== XAI_API_BASE_URL
  ) {
    return
  }

  const cacheKey = payload.prompt_cache_key
  const sessionId =
    cacheKey?.trim() ?
      cacheKey
    : requestContext.getStore()?.sessionAffinity?.trim()
  if (!sessionId) {
    throw new Error(
      "xAI OAuth Responses requests require prompt_cache_key or session affinity",
    )
  }
  headers["x-xai-token-auth"] = "xai-grok-cli"
  headers["x-authenticateresponse"] = "authenticate-response"
  headers["x-grok-client-version"] = await getGrokBuildVersion()
  headers["x-grok-client-identifier"] = "grok-shell"
  headers["x-grok-client-mode"] = "headless"
  headers["x-grok-model-override"] = payload.model
  headers["x-grok-conv-id"] = sessionId
  headers["x-grok-session-id"] = sessionId
  headers["x-grok-req-id"] = randomUUID()
}

export function createProviderProxyResponse(
  upstreamResponse: Response,
  body?: ReadableStream<Uint8Array> | null,
): Response {
  return new Response(body ?? upstreamResponse.body, {
    headers: createProviderProxyResponseHeaders(upstreamResponse.headers),
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
  })
}

export function createProviderProxyResponseHeaders(
  upstreamHeaders: Headers,
): Headers {
  const headers = new Headers(upstreamHeaders)

  for (const headerName of STRIPPED_RESPONSE_HEADERS) {
    headers.delete(headerName)
  }

  return headers
}

export async function forwardProviderMessages(
  providerConfig: ResolvedProviderConfig,
  payload: AnthropicMessagesPayload,
  requestHeaders: Headers,
  options: { clientSignal?: AbortSignal } = {},
): Promise<Response> {
  consola.log(`<-- model: ${payload.model}`)
  const headers = buildProviderUpstreamHeaders(
    providerConfig,
    requestHeaders,
    payload.model,
  )
  applyOpencodeSessionHeader(
    providerConfig,
    headers,
    resolveOpencodeMessagesSession(payload),
  )
  const transportConfig = getUpstreamTransportConfig()
  return await fetchUpstreamWithLifecycle(
    buildProviderUrl(providerConfig, "messages", payload.model),
    {
      method: "POST",
      headers,
      body: JSON.stringify(buildProviderPayload(providerConfig, payload)),
    },
    {
      clientSignal: options.clientSignal,
      headersTimeoutMs: transportConfig.headersTimeoutMs,
      streamInactivityTimeoutMs: transportConfig.streamInactivityTimeoutMs,
    },
  )
}

export async function forwardProviderChatCompletions(
  providerConfig: ResolvedProviderConfig,
  payload: ChatCompletionsPayload,
  requestHeaders: Headers,
  options: { clientSignal?: AbortSignal } = {},
): Promise<Response> {
  consola.log(`<-- model: ${payload.model}`)
  const headers = buildProviderUpstreamHeaders(
    providerConfig,
    requestHeaders,
    payload.model,
  )
  applyOpencodeSessionHeader(
    providerConfig,
    headers,
    payload.prompt_cache_key?.trim() || undefined,
  )
  const transportConfig = getUpstreamTransportConfig()
  return await fetchUpstreamWithLifecycle(
    buildProviderUrl(providerConfig, "chat/completions", payload.model),
    {
      method: "POST",
      headers,
      body: JSON.stringify(buildProviderPayload(providerConfig, payload)),
    },
    {
      clientSignal: options.clientSignal,
      headersTimeoutMs: transportConfig.headersTimeoutMs,
      streamInactivityTimeoutMs: transportConfig.streamInactivityTimeoutMs,
    },
  )
}

export async function forwardProviderResponses(
  providerConfig: ResolvedProviderConfig,
  payload: ResponsesPayload,
  requestHeaders: Headers,
  options: { clientSignal?: AbortSignal } = {},
): Promise<Response> {
  consola.log(`<-- model: ${payload.model}`)
  const transportConfig = getUpstreamTransportConfig()
  const headers = buildProviderUpstreamHeaders(
    providerConfig,
    requestHeaders,
    payload.model,
  )
  applyOpencodeSessionHeader(
    providerConfig,
    headers,
    payload.prompt_cache_key?.trim() || undefined,
  )
  await applyXaiGrokBuildHeaders(providerConfig, headers, payload)
  return await fetchUpstreamWithLifecycle(
    buildProviderUrl(providerConfig, "responses", payload.model),
    {
      method: "POST",
      headers,
      body: JSON.stringify(buildProviderPayload(providerConfig, payload)),
    },
    {
      headersTimeoutMs: transportConfig.headersTimeoutMs,
      clientSignal: options.clientSignal,
      streamInactivityTimeoutMs: transportConfig.streamInactivityTimeoutMs,
    },
  )
}

const PROVIDER_MODELS_TIMEOUT_MS = 15_000

export async function forwardProviderModels(
  providerConfig: ResolvedProviderConfig,
  requestHeaders: Headers,
): Promise<Response> {
  if (providerConfig.type === "google") {
    return await forwardGoogleModels(providerConfig, requestHeaders)
  }
  return await fetch(resolveProviderEndpointUrl(providerConfig, "models"), {
    method: "GET",
    headers: buildProviderUpstreamHeaders(providerConfig, requestHeaders),
    signal: AbortSignal.timeout(PROVIDER_MODELS_TIMEOUT_MS),
  })
}

async function forwardGoogleModels(
  provider: ResolvedProviderConfig,
  requestHeaders: Headers,
): Promise<Response> {
  const data: Array<Record<string, unknown>> = []
  const pageTokens = new Set<string>()
  let pageToken: string | undefined
  const signal = AbortSignal.timeout(PROVIDER_MODELS_TIMEOUT_MS)
  do {
    const url = new URL(resolveProviderEndpointUrl(provider, "models"))
    url.searchParams.set("pageSize", "1000")
    if (pageToken) url.searchParams.set("pageToken", pageToken)
    const upstream = await fetch(url, {
      headers: buildProviderUpstreamHeaders(provider, requestHeaders),
      signal,
    })
    if (!upstream.ok) return upstream
    const body = (await upstream.json()) as GoogleModelsResponse
    for (const model of body.models ?? []) {
      if (!model.supportedGenerationMethods?.includes("generateContent"))
        continue
      data.push({
        id: model.name.replace(/^models\//u, ""),
        object: "model",
        owned_by: provider.name,
        name: model.displayName,
        display_name: model.displayName,
        description: model.description,
        context_window: model.inputTokenLimit,
        max_output_tokens: model.outputTokenLimit,
      })
    }
    pageToken = body.nextPageToken
    if (pageToken && pageTokens.has(pageToken))
      throw new Error("Google models returned a repeated page token")
    if (pageToken) pageTokens.add(pageToken)
  } while (pageToken)
  return Response.json({ object: "list", data, has_more: false })
}

/** Align with Codex images: long-running generation/edits need a generous cap. */
const PROVIDER_IMAGES_TIMEOUT_MS = 15 * 60 * 1000

const providerImagesDispatcher = createTimeoutDispatcher(
  PROVIDER_IMAGES_TIMEOUT_MS,
)

function resolveProviderRequestUrl(
  providerConfig: ResolvedProviderConfig,
  requestUrl: string,
  path: string,
): string {
  const upstreamUrl = new URL(
    resolveProviderEndpointUrl(providerConfig, path.replace(/^\/v1\//u, "")),
  )
  upstreamUrl.search = new URL(requestUrl, "http://localhost").search
  return upstreamUrl.toString()
}

export async function forwardProviderAlphaSearch(
  providerConfig: ResolvedProviderConfig,
  request: Request,
  options: { clientSignal?: AbortSignal } = {},
): Promise<Response> {
  const headers = buildProviderUpstreamHeaders(providerConfig, request.headers)
  const body = await request.arrayBuffer()
  const transportConfig = getUpstreamTransportConfig()

  return await fetchUpstreamWithLifecycle(
    resolveProviderRequestUrl(providerConfig, request.url, "/v1/alpha/search"),
    {
      method: "POST",
      headers,
      body,
    },
    {
      clientSignal: options.clientSignal,
      headersTimeoutMs: transportConfig.headersTimeoutMs,
      streamInactivityTimeoutMs: transportConfig.streamInactivityTimeoutMs,
    },
  )
}

export async function forwardProviderImages(
  providerConfig: ResolvedProviderConfig,
  request: Request,
  operation: "generations" | "edits",
): Promise<Response> {
  const headers = buildProviderUpstreamHeaders(providerConfig, request.headers)
  const contentType = request.headers.get("content-type")
  if (contentType) {
    headers["content-type"] = contentType
  } else if (operation === "edits") {
    delete headers["content-type"]
  }

  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers,
    body: request.body,
    duplex: "half",
    signal: AbortSignal.any([
      request.signal,
      AbortSignal.timeout(PROVIDER_IMAGES_TIMEOUT_MS),
    ]),
  }

  const upstreamUrl = resolveProviderRequestUrl(
    providerConfig,
    request.url,
    `/v1/images/${operation}`,
  )

  if (typeof Bun !== "undefined") {
    return await fetch(upstreamUrl, init)
  }

  // Node's global fetch keeps Undici's shorter default headers/body timeouts.
  // Use an explicit dispatcher so the documented 15-minute cap applies there.
  return (await undiciFetch(upstreamUrl, {
    ...init,
    dispatcher: providerImagesDispatcher,
  } as unknown as UndiciRequestInit)) as unknown as Response
}
