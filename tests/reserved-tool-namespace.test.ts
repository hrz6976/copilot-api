import { describe, expect, test } from "bun:test"

import {
  aliasReservedToolNamespaces,
  needsCloudGptReservedNamespaceCompatibility,
  restoreReservedToolNamespaces,
} from "../src/lib/reserved-tool-namespace"

describe("reserved tool namespace compatibility", () => {
  test("targets only CloudGPT GPT-5.6 models", () => {
    expect(
      needsCloudGptReservedNamespaceCompatibility(
        "cloudgpt",
        "gpt-5.6-sol-20260709",
      ),
    ).toBe(true)
    expect(
      needsCloudGptReservedNamespaceCompatibility("cloudgpt", "gpt-5.5"),
    ).toBe(false)
    expect(
      needsCloudGptReservedNamespaceCompatibility("codex", "gpt-5.6-sol"),
    ).toBe(false)
  })

  test("aliases namespace tools and replayed calls without mutating input", () => {
    const payload = {
      model: "gpt-5.6-sol-20260709",
      input: [
        {
          type: "function_call" as const,
          call_id: "call-1",
          name: "spawn_agent",
          namespace: "collaboration",
          arguments: "{}",
        },
      ],
      tools: [
        {
          type: "namespace" as const,
          name: "collaboration",
          tools: [
            {
              type: "function" as const,
              name: "spawn_agent",
              parameters: {},
              strict: false,
            },
          ],
        },
      ],
    }

    const aliased = aliasReservedToolNamespaces(payload)

    expect(aliased.tools?.[0]).toMatchObject({
      type: "namespace",
      name: "codex_collaboration",
    })
    expect(aliased.input?.[0]).toMatchObject({
      type: "function_call",
      namespace: "codex_collaboration",
    })
    expect(payload.tools[0].name).toBe("collaboration")
    expect(payload.input[0].namespace).toBe("collaboration")
  })

  test("restores namespace aliases in response events", () => {
    const event = restoreReservedToolNamespaces({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        name: "spawn_agent",
        namespace: "codex_collaboration",
      },
      response: {
        tools: [
          {
            type: "namespace",
            name: "codex_collaboration",
          },
        ],
      },
    })

    expect(event.item.namespace).toBe("collaboration")
    expect(event.response.tools[0].name).toBe("collaboration")
  })
})
