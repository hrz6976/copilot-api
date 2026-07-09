import { afterEach, beforeEach, expect, test } from "bun:test"
import { Hono } from "hono"

const DB_PATH_ENV = "COPILOT_API_SQLITE_DB_PATH"

const { state } = await import("../src/lib/state")
const { closeUsageStore } = await import("../src/lib/token-usage")
const { completionRoutes } = await import(
  "../src/routes/chat-completions/route"
)

const originalFetch = globalThis.fetch

const createApp = (): Hono => {
  const app = new Hono()
  app.route("/v1/chat/completions", completionRoutes)
  return app
}

const streamingChunk = () =>
  "data: "
  + JSON.stringify({
    id: "chatcmpl-stream",
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-test",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "partial" },
        finish_reason: null,
        logprobs: null,
      },
    ],
  })
  + "\n\n"

beforeEach(async () => {
  process.env[DB_PATH_ENV] = ":memory:"
  await closeUsageStore()

  state.copilotToken = "test-token"
  state.accountType = "individual"
  state.macMachineId = "machine-1"
  state.verbose = false
  state.vsCodeDeviceId = "device-1"
  state.vsCodeSessionId = "session-1"
  state.vsCodeVersion = "1.120.0"
  state.models = {
    object: "list",
    data: [
      {
        capabilities: { limits: { max_output_tokens: 4096 } },
        id: "gpt-test",
        supported_endpoints: ["/chat/completions"],
      },
    ],
  } as typeof state.models
})

afterEach(async () => {
  await closeUsageStore()
  Reflect.deleteProperty(process.env, DB_PATH_ENV)
  globalThis.fetch = originalFetch
})

test("forwards a thrown mid-stream error as an OpenAI chat error event", async () => {
  globalThis.fetch = (() => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(streamingChunk()))
        controller.error(new Error("copilot upstream reset"))
      },
    })
    return Promise.resolve(
      new Response(body, {
        headers: { "content-type": "text/event-stream" },
      }),
    )
  }) as unknown as typeof fetch

  const response = await createApp().request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "hello" }],
      model: "gpt-test",
      stream: true,
    }),
  })

  expect(response.status).toBe(200)
  const text = await response.text()
  expect(text).toContain("event: error")
  expect(text).toContain("copilot upstream reset")
  expect(text).toContain("data: [DONE]")
})

test("streams chat completion chunks through on success", async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response([streamingChunk(), "data: [DONE]\n\n"].join(""), {
        headers: { "content-type": "text/event-stream" },
      }),
    )) as unknown as typeof fetch

  const response = await createApp().request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "hello" }],
      model: "gpt-test",
      stream: true,
    }),
  })

  expect(response.status).toBe(200)
  const text = await response.text()
  expect(text).toContain('"content":"partial"')
  expect(text).toContain("data: [DONE]")
  expect(text).not.toContain("event: error")
})
