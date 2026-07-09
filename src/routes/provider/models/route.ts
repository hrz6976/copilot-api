import { Hono } from "hono"

import { getProviderConfig } from "~/lib/config"
import { forwardError } from "~/lib/error"
import { createHandlerLogger } from "~/lib/logger"
import { resolveProviderConfig } from "~/lib/provider-resolver"
import { getModels as getCloudGptModels } from "~/services/cloudgpt/get-models"
import { getModels as getCodexModels } from "~/services/codex/get-models"
import {
  createProviderProxyResponse,
  forwardProviderModels,
} from "~/services/providers/provider-proxy"

const logger = createHandlerLogger("provider-models-handler")

export const providerModelRoutes = new Hono()

providerModelRoutes.get("/", async (c) => {
  const provider = c.req.param("provider") ?? ""

  try {
    // The CloudGPT catalog is static; don't require a live Azure CLI token
    // (which resolveProviderConfig would acquire) just to list it
    if (provider.trim() === "cloudgpt" && getProviderConfig("cloudgpt")) {
      const models = getCloudGptModels()
      return c.json({
        object: "list",
        data: models.data,
        has_more: false,
      })
    }

    const providerConfig = await resolveProviderConfig(provider)
    if (!providerConfig) {
      return c.json(
        {
          error: {
            message: `Provider '${provider}' not found or disabled`,
            type: "invalid_request_error",
          },
        },
        404,
      )
    }

    if (providerConfig.name === "codex") {
      const models = getCodexModels()
      return c.json({
        object: "list",
        data: models.data,
        has_more: false,
      })
    }

    const upstreamResponse = await forwardProviderModels(
      providerConfig,
      c.req.raw.headers,
    )

    logger.debug("provider.models.response", {
      provider,
      statusCode: upstreamResponse.status,
    })

    return createProviderProxyResponse(upstreamResponse)
  } catch (error) {
    logger.error("provider.models.error", {
      provider,
      error,
    })
    return await forwardError(c, error)
  }
})
