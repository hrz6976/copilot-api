import type { SSEStreamingApi } from "hono/streaming"

import type {
  ResponseErrorEvent,
  ResponseFailedEvent,
  ResponsesResult,
} from "~/lib/types/responses"

/**
 * Shared error passthrough for the Responses (SSE) streaming paths.
 *
 * When an upstream provider fails mid-stream - either by throwing while the SSE
 * body is being consumed, or by emitting an `error` event - the client would
 * otherwise just see the socket close without a `response.completed` event
 * (Codex reports this as "stream closed before response.completed"). To surface
 * the real reason we emit a synthetic `response.failed` event (which carries
 * `response.error.message`, the field clients render) immediately followed by an
 * OpenAI-style `error` event.
 */

export interface ResponsesStreamErrorInfo {
  code: string | null
  message: string
  param: string | null
  type: string | null
}

const DEFAULT_STREAM_ERROR_MESSAGE = "Upstream responses stream failed"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/** Extract a client-facing error from a thrown value. */
export const getResponsesStreamErrorInfo = (
  error: unknown,
): ResponsesStreamErrorInfo => {
  if (error instanceof Error && error.message) {
    return {
      code: null,
      message: error.message,
      param: null,
      type: error.name || null,
    }
  }

  const message = String(error)
  return {
    code: null,
    message: message || DEFAULT_STREAM_ERROR_MESSAGE,
    param: null,
    type: null,
  }
}

/** Extract a client-facing error from an upstream SSE `data:` payload. */
export const parseResponsesStreamErrorInfo = (
  data: string,
  fallbackMessage: string = DEFAULT_STREAM_ERROR_MESSAGE,
): ResponsesStreamErrorInfo => {
  let message = fallbackMessage
  let code: string | null = null
  let param: string | null = null
  let type: string | null = null

  try {
    const parsed = JSON.parse(data) as unknown
    const candidate =
      isRecord(parsed) && isRecord(parsed.error) ? parsed.error : parsed
    if (isRecord(candidate)) {
      if (typeof candidate.message === "string") {
        message = candidate.message
      }
      if (typeof candidate.code === "string") {
        code = candidate.code
      }
      if (typeof candidate.param === "string") {
        param = candidate.param
      }
      if (typeof candidate.type === "string") {
        type = candidate.type
      }
    }
  } catch {
    if (data.trim().length > 0) {
      message = data
    }
  }

  return { code, message, param, type }
}

interface FailedResponseOptions {
  model?: string
  responseId?: string
}

export const buildFailedResponsesResult = (
  info: ResponsesStreamErrorInfo,
  options: FailedResponseOptions = {},
): ResponsesResult => ({
  id: options.responseId ?? "resp_error",
  object: "response",
  created_at: 0,
  model: options.model ?? "",
  output: [],
  output_text: "",
  status: "failed",
  error: { code: info.code, message: info.message },
  incomplete_details: null,
  instructions: null,
  metadata: null,
  parallel_tool_calls: false,
  temperature: null,
  tool_choice: null,
  tools: [],
  top_p: null,
})

interface WriteResponsesStreamFailureOptions extends FailedResponseOptions {
  /** Sequence number to use for the emitted `response.failed` event. */
  sequenceNumber: number
}

/**
 * Emit a terminal `response.failed` event followed by an `error` event so the
 * client learns why the stream ended. Returns the last sequence number used, so
 * callers can keep their own counter monotonically increasing.
 */
export const writeResponsesStreamFailure = async (
  stream: SSEStreamingApi,
  info: ResponsesStreamErrorInfo,
  options: WriteResponsesStreamFailureOptions,
): Promise<number> => {
  const failedSequenceNumber = options.sequenceNumber
  const failedEvent: ResponseFailedEvent = {
    type: "response.failed",
    sequence_number: failedSequenceNumber,
    response: buildFailedResponsesResult(info, options),
  }
  await stream.writeSSE({
    event: failedEvent.type,
    data: JSON.stringify(failedEvent),
  })

  const errorSequenceNumber = failedSequenceNumber + 1
  const errorEvent: ResponseErrorEvent = {
    type: "error",
    sequence_number: errorSequenceNumber,
    code: info.code,
    message: info.message,
    param: info.param,
    error: {
      code: info.code,
      message: info.message,
      type: info.type,
    },
  }
  await stream.writeSSE({
    event: errorEvent.type,
    data: JSON.stringify(errorEvent),
  })

  return errorSequenceNumber
}
