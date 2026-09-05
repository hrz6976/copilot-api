import type { ResponsesPayload } from "~/lib/types/responses"

const COLLABORATION_NAMESPACE = "collaboration"
const COLLABORATION_NAMESPACE_ALIAS = "codex_collaboration"
const CLOUDGPT_GPT56_MODEL_PATTERN = /^gpt-5\.6(?:-|$)/u

export const needsCloudGptReservedNamespaceCompatibility = (
  providerName: string,
  model: string,
): boolean =>
  providerName === "cloudgpt" && CLOUDGPT_GPT56_MODEL_PATTERN.test(model)

export const aliasReservedToolNamespaces = (
  payload: ResponsesPayload,
): ResponsesPayload =>
  transformReservedToolNamespace(
    payload,
    COLLABORATION_NAMESPACE,
    COLLABORATION_NAMESPACE_ALIAS,
  ) as ResponsesPayload

export const restoreReservedToolNamespaces = <T>(value: T): T =>
  transformReservedToolNamespace(
    value,
    COLLABORATION_NAMESPACE_ALIAS,
    COLLABORATION_NAMESPACE,
  ) as T

const transformReservedToolNamespace = (
  value: unknown,
  sourceNamespace: string,
  targetNamespace: string,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) =>
      transformReservedToolNamespace(item, sourceNamespace, targetNamespace),
    )
  }

  if (!isRecord(value)) {
    return value
  }

  const transformed = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      transformReservedToolNamespace(item, sourceNamespace, targetNamespace),
    ]),
  )

  if (transformed.namespace === sourceNamespace) {
    transformed.namespace = targetNamespace
  }
  if (
    transformed.type === "namespace"
    && transformed.name === sourceNamespace
  ) {
    transformed.name = targetNamespace
  }

  return transformed
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
