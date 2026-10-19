import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import type { ResolvedProviderConfig } from "~/lib/config"
import { UpstreamHeadersTimeoutError } from "~/lib/error"
import { systemOneRouteDependencies } from "~/routes/systemone/route"
import { createServer } from "~/server"
import { forwardCloudGptSystemOne } from "~/services/cloudgpt/systemone"

const originalDependencies = { ...systemOneRouteDependencies }
const originalFetch = globalThis.fetch
const providerConfig: ResolvedProviderConfig = {
  name: "cloudgpt",
  type: "openai-compatible",
  baseUrl: "https://cloudgpt-openai.azure-api.net/openai",
  apiKey: "upstream-azure-token",
  authType: "authorization",
}
const payload = {
  model: "Microsoft-Decision-1",
  state: { message: "I was charged twice.", history: ["subscription"] },
  questions: {
    department: {
      type: "choice",
      instructions: "Which support team should handle this?",
      criteria: { billing: null, technical: null },
    },
  },
  metadata: { request: "keep-this-field" },
}
const upstreamBody = JSON.stringify({
  model: "microsoft-decision-1",
  answers: {
    department: { type: "choice", choice: "billing", confidence: 0.99 },
  },
  usage: { input_tokens: 40, output_tokens: 1 },
})

const resolveProvider = mock((_provider: string) =>
  Promise.resolve<ResolvedProviderConfig | null>(providerConfig),
)
const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
  Promise.resolve(
    new Response(upstreamBody, {
      headers: {
        "content-type": "application/json",
        "x-request-id": "decision-request-id",
      },
    }),
  ),
)

const app = createServer({ getApiKeys: () => ["gateway-key"] })

async function request(
  path: string,
  body: unknown = payload,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers: {
      authorization: "Bearer gateway-key",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function parseJsonBody(body: unknown): unknown {
  if (typeof body !== "string") throw new Error("Expected a JSON request body")
  return JSON.parse(body) as unknown
}

beforeEach(() => {
  resolveProvider.mockClear()
  fetchMock.mockClear()
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(upstreamBody, {
        headers: {
          "content-type": "application/json",
          "x-request-id": "decision-request-id",
        },
      }),
    ),
  )
  resolveProvider.mockImplementation(() => Promise.resolve(providerConfig))
  systemOneRouteDependencies.resolveProviderConfig = resolveProvider
  systemOneRouteDependencies.resolveMappedModel = (model) => model
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  Object.assign(systemOneRouteDependencies, originalDependencies)
  globalThis.fetch = originalFetch
})

describe("CloudGPT decision forwarding", () => {
  test.each([
    ["/cloudgpt/v1/systemone", "Microsoft-Decision-1", "Microsoft-Decision-1"],
    ["/cloudgpt/systemone", "OCTO-PI", "OCTO-PI"],
    ["/v1/systemone", "cloudgpt/Microsoft-Decision-1", "Microsoft-Decision-1"],
    ["/systemone", "cloudgpt/OCTO-PI", "OCTO-PI"],
  ])(
    "forwards %s using the same provider authentication",
    async (path, model, deployment) => {
      const response = await request(
        `${path}?trace=example`,
        { ...payload, model },
        {
          "x-api-key": "gateway-key",
          cookie: "local-session=secret",
          "user-agent": "typesafe-sdk-test",
          accept: "application/json",
        },
      )
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(upstreamBody)
      expect(response.headers.get("x-request-id")).toBe("decision-request-id")
      expect(resolveProvider).toHaveBeenCalledWith("cloudgpt")
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] ?? []
      expect(url).toHaveProperty(
        "href",
        "https://cloudgpt-openai.azure-api.net/decision-api/v1/systemone?trace=example",
      )
      const headers = new Headers(init?.headers)
      expect(headers.get("authorization")).toBe("Bearer upstream-azure-token")
      expect(headers.get("x-api-key")).toBeNull()
      expect(headers.get("cookie")).toBeNull()
      expect(headers.get("user-agent")).toBe("typesafe-sdk-test")
      expect(headers.get("accept")).toBe("application/json")
      expect(headers.get("content-type")).toBe("application/json")
      expect(parseJsonBody(init?.body)).toEqual({
        ...payload,
        model: deployment,
      })
    },
  )

  test("resolves shared-route model mappings as completion routes do", async () => {
    systemOneRouteDependencies.resolveMappedModel = (model) =>
      model === "decision" ? "cloudgpt/OCTO-PI" : model
    const response = await request("/v1/systemone", {
      ...payload,
      model: "decision",
    })
    expect(response.status).toBe(200)
    await response.text()
    expect(parseJsonBody(fetchMock.mock.calls[0]?.[1]?.body)).toEqual({
      ...payload,
      model: "OCTO-PI",
    })
  })

  test("does not restrict forwarding to the static deployment catalog", async () => {
    const response = await request("/cloudgpt/v1/systemone", {
      ...payload,
      model: "future-decision-deployment",
    })
    expect(response.status).toBe(200)
    await response.text()
    expect(parseJsonBody(fetchMock.mock.calls[0]?.[1]?.body)).toEqual({
      ...payload,
      model: "future-decision-deployment",
    })
  })

  test.each([401, 403, 404, 422, 429, 500])(
    "preserves upstream HTTP %s and its original error body",
    async (status) => {
      const errorBody = `upstream decision error ${status}`
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          new Response(errorBody, {
            status,
            headers: {
              "content-type": "text/plain",
              "retry-after": "12",
              "content-length": String(errorBody.length),
              connection: "keep-alive",
            },
          }),
        ),
      )
      const response = await request("/cloudgpt/v1/systemone")
      expect(response.status).toBe(status)
      expect(await response.text()).toBe(errorBody)
      expect(response.headers.get("content-type")).toBe("text/plain")
      expect(response.headers.get("retry-after")).toBe("12")
      expect(response.headers.has("content-length")).toBe(false)
      expect(response.headers.has("connection")).toBe(false)
    },
  )

  test.each(["", "Bearer cloudgpt-token", "Bearer wrong-gateway-key"])(
    "rejects invalid local authentication before resolving Azure credentials: %s",
    async (authorization) => {
      const response = await request("/cloudgpt/v1/systemone", payload, {
        authorization,
      })
      expect(response.status).toBe(401)
      expect(resolveProvider).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  test("accepts the gateway x-api-key header", async () => {
    const response = await request("/cloudgpt/v1/systemone", payload, {
      authorization: "",
      "x-api-key": "gateway-key",
    })
    expect(response.status).toBe(200)
    await response.text()
  })

  test.each([
    null,
    [],
    {},
    { ...payload, model: "" },
    { ...payload, model: 1 },
    { model: payload.model, questions: {} },
    { ...payload, questions: [] },
    { ...payload, questions: null },
  ])(
    "rejects malformed request fields before obtaining a token: %j",
    async (body) => {
      const response = await request("/cloudgpt/v1/systemone", body)
      expect(response.status).toBe(400)
      expect(resolveProvider).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  test("returns HTTP 400 for invalid JSON", async () => {
    const response = await app.request("/cloudgpt/v1/systemone", {
      method: "POST",
      headers: {
        authorization: "Bearer gateway-key",
        "content-type": "application/json",
      },
      body: "{",
    })
    expect(response.status).toBe(400)
    expect(resolveProvider).not.toHaveBeenCalled()
  })

  test.each([
    ["/v1/systemone", "Microsoft-Decision-1"],
    ["/v1/systemone", "other/Microsoft-Decision-1"],
    ["/other/v1/systemone", "Microsoft-Decision-1"],
  ])("rejects unsupported routing at %s with model %s", async (path, model) => {
    const response = await request(path, { ...payload, model })
    expect(response.status).toBe(400)
    expect(resolveProvider).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("returns HTTP 404 when CloudGPT is missing or disabled", async () => {
    resolveProvider.mockImplementation(() => Promise.resolve(null))
    const response = await request("/cloudgpt/v1/systemone")
    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("reports credential acquisition errors without forwarding a request", async () => {
    resolveProvider.mockImplementation(() =>
      Promise.reject(new Error("Azure CLI login required")),
    )
    const response = await request("/cloudgpt/v1/systemone")
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: { message: "Azure CLI login required" },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("uses the existing upstream timeout error mapping", async () => {
    fetchMock.mockImplementation(() =>
      Promise.reject(new UpstreamHeadersTimeoutError(100)),
    )
    const response = await request("/cloudgpt/v1/systemone")
    expect(response.status).toBe(504)
    expect(await response.json()).toMatchObject({
      error: { type: "upstream_timeout" },
    })
  })

  test("supports the existing zstd request middleware", async () => {
    const response = await app.request("/cloudgpt/v1/systemone", {
      method: "POST",
      headers: {
        authorization: "Bearer gateway-key",
        "content-type": "application/json",
        "content-encoding": "zstd",
      },
      body: Bun.zstdCompressSync(JSON.stringify(payload)),
    })
    expect(response.status).toBe(200)
    await response.text()
    expect(parseJsonBody(fetchMock.mock.calls[0]?.[1]?.body)).toEqual(payload)
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has(
        "content-encoding",
      ),
    ).toBe(false)
  })

  test.each([
    [
      "https://example.com/custom/openai/v1/",
      "https://example.com/custom/decision-api/v1/systemone",
    ],
    [
      "https://example.com/custom/openai/",
      "https://example.com/custom/decision-api/v1/systemone",
    ],
    ["https://example.com", "https://example.com/decision-api/v1/systemone"],
  ])(
    "respects the configured CloudGPT base URL %s",
    async (baseUrl, expectedUrl) => {
      const response = await forwardCloudGptSystemOne(
        { ...providerConfig, baseUrl },
        payload,
        new Request("http://localhost/cloudgpt/v1/systemone"),
      )
      await response.text()
      expect(fetchMock.mock.calls[0]?.[0]).toHaveProperty("href", expectedUrl)
    },
  )

  test("does not dispatch a client request cancelled before forwarding", async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await forwardCloudGptSystemOne(
      providerConfig,
      payload,
      new Request("http://localhost/cloudgpt/v1/systemone", {
        signal: controller.signal,
      }),
    ).catch((error: unknown) => error)
    expect(error).toHaveProperty("name", "AbortError")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
