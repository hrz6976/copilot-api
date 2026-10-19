import {
  getUpstreamTransportConfig,
  type ResolvedProviderConfig,
} from "~/lib/config"
import { buildProviderUpstreamHeaders } from "~/services/providers/provider-proxy"
import { fetchUpstreamWithLifecycle } from "~/services/upstream-http"

export interface SystemOnePayload {
  [key: string]: unknown
  model: string
  state: unknown
  questions: Record<string, unknown>
}

export async function forwardCloudGptSystemOne(
  providerConfig: ResolvedProviderConfig,
  payload: SystemOnePayload,
  request: Request,
): Promise<Response> {
  const url = new URL(providerConfig.baseUrl)
  // The same provider config serves completions under /openai and scoring
  // under its sibling /decision-api path. Retain any custom proxy prefix.
  const prefix = url.pathname
    .replace(/\/+$/u, "")
    .replace(/\/openai(?:\/v1)?$/u, "")
  url.pathname = `${prefix}/decision-api/v1/systemone`
  url.search = new URL(request.url).search
  url.hash = ""

  const transport = getUpstreamTransportConfig()
  return await fetchUpstreamWithLifecycle(
    url,
    {
      method: "POST",
      headers: buildProviderUpstreamHeaders(providerConfig, request.headers),
      body: JSON.stringify(payload),
    },
    {
      clientSignal: request.signal,
      headersTimeoutMs: transport.headersTimeoutMs,
      streamInactivityTimeoutMs: transport.streamInactivityTimeoutMs,
    },
  )
}
