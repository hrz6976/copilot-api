import { Hono, type Context } from "hono"

import { resolveMappedModel } from "~/lib/config"
import { forwardError } from "~/lib/error"
import { parseProviderModelAlias } from "~/lib/provider-model"
import { resolveProviderConfig } from "~/lib/provider-resolver"
import { zstdDecompressionMiddleware } from "~/lib/zstd-request"
import {
  forwardCloudGptSystemOne,
  type SystemOnePayload,
} from "~/services/cloudgpt/systemone"
import { createProviderProxyResponse } from "~/services/providers/provider-proxy"

export const systemOneRoutes = new Hono()

export const systemOneRouteDependencies = {
  resolveMappedModel,
  resolveProviderConfig,
}

function invalidRequest(c: Context, message: string): Response {
  return c.json({ error: { message, type: "invalid_request_error" } }, 400)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function parsePayload(c: Context): Promise<SystemOnePayload | Response> {
  let body: unknown
  try {
    body = await c.req.json<unknown>()
  } catch {
    return invalidRequest(c, "Expected a JSON decision request body")
  }
  if (
    !isRecord(body)
    || typeof body.model !== "string"
    || !body.model.trim()
    || !Object.hasOwn(body, "state")
    || !isRecord(body.questions)
  ) {
    return invalidRequest(
      c,
      "Decision requests require model, state, and a questions object",
    )
  }
  return body as SystemOnePayload
}

systemOneRoutes.use(zstdDecompressionMiddleware)

systemOneRoutes.post("/", async (c) => {
  try {
    const payload = await parsePayload(c)
    if (payload instanceof Response) return payload

    const scopedProvider = c.req.param("provider")
    const alias =
      scopedProvider ?
        { provider: scopedProvider, model: payload.model }
      : parseProviderModelAlias(
          systemOneRouteDependencies.resolveMappedModel(payload.model),
        )
    if (!alias) {
      return invalidRequest(
        c,
        "Use a provider/model name, such as cloudgpt/Microsoft-Decision-1",
      )
    }
    if (alias.provider !== "cloudgpt") {
      return invalidRequest(
        c,
        "The /v1/systemone endpoint supports only the cloudgpt provider",
      )
    }

    const providerConfig =
      await systemOneRouteDependencies.resolveProviderConfig(alias.provider)
    if (!providerConfig) {
      return c.json(
        {
          error: {
            message: "Provider 'cloudgpt' not found or disabled",
            type: "invalid_request_error",
          },
        },
        404,
      )
    }

    const response = await forwardCloudGptSystemOne(
      providerConfig,
      { ...payload, model: alias.model },
      c.req.raw,
    )
    return createProviderProxyResponse(response)
  } catch (error) {
    return await forwardError(c, error)
  }
})
