import type {
  ContentPart,
  Message,
} from "~/services/copilot/create-chat-completions"

export type OpenAIFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | null

export const getTextFromOpenAIContent = (
  content: Message["content"],
): string => {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .flatMap((part) => {
      const text = translateOpenAIContentPartToText(part)
      return text ? [text] : []
    })
    .join("\n")
}

export const translateOpenAIContentPartToText = (
  part: ContentPart,
): string | undefined => {
  if (part.type === "text") {
    return part.text
  }

  if (part.type === "image_url") {
    return parseDataUrl(part.image_url.url) ? undefined : part.image_url.url
  }

  if (part.type === "file") {
    return parseDataUrl(part.file.file_data) ? undefined : (
        (part.file.filename ?? part.file.file_data)
      )
  }

  return undefined
}

export const parseDataUrl = (
  value: string,
): { mediaType: string; data: string } | null => {
  const match = /^data:([^;,]+);base64,(.*)$/u.exec(value)
  if (!match) {
    return null
  }

  return {
    mediaType: match[1],
    data: match[2],
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const nowSeconds = (): number => Math.floor(Date.now() / 1000)
