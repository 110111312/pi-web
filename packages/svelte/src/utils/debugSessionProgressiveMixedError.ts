import { ERROR_FIXTURE_MESSAGE } from "./debugSessionFixtures";
import { materializeMessage, userMessage } from "./debugSessionMessages";
import { buildSnapshotStream } from "./debugSessionStreamBuilders";
import { progressiveBashFixture, progressiveReadFixture } from "./debugSessionProgressiveBasic";
import {
  progressiveEditFixture,
  progressiveWriteFixture,
} from "./debugSessionProgressiveEditWrite";
import { progressiveMarkdownFixture } from "./debugSessionProgressiveBasic";
import type { DebugPromptResult, DebugSession } from "./debugSessionTypes";
import { nextDebugId } from "./debugSessionTypes";

export function progressiveMixedFixture(
  session: DebugSession,
): DebugPromptResult {
  const assistantMessageId = nextDebugId("msg");
  const toolCallId = nextDebugId("tool");
  const user = userMessage(
    "Please preview the transcript renderer without sending a real LLM request.",
  );
  const thinkingLineOne = "I can stay entirely client-side.";
  const thinkingFull = [
    thinkingLineOne,
    "I should exercise both Markdown and tool block render branches.",
  ].join("\n");
  const toolArguments = {
    path: "packages/svelte/src/components/MarkdownRenderer.svelte",
    offset: 220,
    limit: 18,
  };
  const toolResultText = [
    "function enhanceInlineFileReferences() {",
    "  const root = markdownBody();",
    "  if (!root) return;",
    '  const nodes = root.querySelectorAll<HTMLElement>("code:not(pre code)");',
    "  // ...",
    "}",
  ].join("\n");
  const finalMarkdown = [
    "### Follow-up Markdown",
    "",
    "- Tool blocks should collapse into inline summaries.",
    "- Inline file refs like `packages/svelte/src/components/MarkdownRenderer.svelte:243` should stay clickable.",
  ].join("\n");

  const snapshots = [
    materializeMessage({
      id: assistantMessageId,
      role: "assistant",
      content: [{ type: "thinking", thinking: thinkingLineOne }],
    }),
    materializeMessage({
      id: assistantMessageId,
      role: "assistant",
      content: [
        { type: "thinking", thinking: thinkingFull },
        {
          type: "text",
          text: "I created a local debug session and inserted a synthetic tool call.",
        },
      ],
    }),
    materializeMessage({
      id: assistantMessageId,
      role: "assistant",
      content: [
        { type: "thinking", thinking: thinkingFull },
        {
          type: "text",
          text: "I created a local debug session and inserted a synthetic tool call.",
        },
        {
          type: "toolCall",
          id: toolCallId,
          name: "read",
          arguments: toolArguments,
        },
      ],
    }),
    materializeMessage({
      id: assistantMessageId,
      role: "assistant",
      content: [
        { type: "thinking", thinking: thinkingFull },
        {
          type: "text",
          text: "I created a local debug session and inserted a synthetic tool call.",
        },
        {
          type: "toolCall",
          id: toolCallId,
          name: "read",
          arguments: toolArguments,
        },
        {
          type: "toolResult",
          content: [{ type: "text", text: toolResultText }],
        },
      ],
    }),
    materializeMessage({
      id: assistantMessageId,
      role: "assistant",
      content: [
        { type: "thinking", thinking: thinkingFull },
        {
          type: "text",
          text: "I created a local debug session and inserted a synthetic tool call.",
        },
        {
          type: "toolCall",
          id: toolCallId,
          name: "read",
          arguments: toolArguments,
        },
        {
          type: "toolResult",
          content: [{ type: "text", text: toolResultText }],
        },
        { type: "text", text: finalMarkdown },
      ],
    }),
  ];

  return buildSnapshotStream(session, [user], snapshots, [
    thinkingFull,
    JSON.stringify(toolArguments),
    toolResultText,
    finalMarkdown,
  ]);
}

export function progressiveErrorFixture(
  session: DebugSession,
): DebugPromptResult {
  const assistantId = nextDebugId("msg");
  const intro = [
    "### Error Fixture",
    "",
    "Preparing a synthetic tool response that will intentionally fail during normalization.",
  ].join("\n");
  const preError = [
    intro,
    "",
    "Attempting to parse the final tool payload...",
  ].join("\n");

  const snapshots = [
    materializeMessage({
      id: assistantId,
      role: "assistant",
      content: [{ type: "text", text: intro }],
    }),
    materializeMessage({
      id: assistantId,
      role: "assistant",
      content: [{ type: "text", text: preError }],
    }),
    materializeMessage({
      id: assistantId,
      role: "assistant",
      stopReason: "error",
      errorMessage: ERROR_FIXTURE_MESSAGE,
    }),
  ];

  return buildSnapshotStream(session, [], snapshots, [
    preError,
    ERROR_FIXTURE_MESSAGE,
  ]);
}

/**
 * Dispatch a fixture name (e.g. "markdown", "tool-read") to the matching
 * progressive builder. Returns null when the name is unknown so the caller
 * can raise a friendly error.
 */
export function streamingFixtureResult(
  session: DebugSession,
  name: string,
): DebugPromptResult | null {
  switch (name.trim().toLowerCase()) {
    case "markdown":
      return progressiveMarkdownFixture(session);
    case "tool-read":
    case "read":
      return progressiveReadFixture(session);
    case "tool-bash":
    case "bash":
      return progressiveBashFixture(session);
    case "tool-edit":
    case "edit":
      return progressiveEditFixture(session);
    case "tool-write":
    case "write":
      return progressiveWriteFixture(session);
    case "mixed":
    case "all":
      return progressiveMixedFixture(session);
    case "error":
      return progressiveErrorFixture(session);
    default:
      return null;
  }
}