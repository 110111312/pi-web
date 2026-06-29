import type { RpcTranscriptMessage } from "@pi-web/bridge/types";

import {
  appendMessages,
  materializeMessage,
  setDebugSessionStreaming,
} from "./debugSessionMessages";
import { countApproxTokens, delayForTokens } from "./debugSessionTokens";
import type { DebugPromptResult, DebugSession, DebugStreamPlan } from "./debugSessionTypes";
import { nextDebugId } from "./debugSessionTypes";

/**
 * Build a streaming plan that progressively reveals `lines` of plain text,
 * chunked every `linesPerChunk` lines. Returns the initial message that
 * should be appended immediately, plus a series of follow-up snapshots
 * with `delayMs` hints for how long to wait between chunks.
 */
export function buildTextStream(
  session: DebugSession,
  lines: readonly string[],
  linesPerChunk: number,
): DebugPromptResult {
  const messageId = nextDebugId("msg");
  const snapshots = buildProgressiveTextMessages(lines, messageId, linesPerChunk);
  const [initialMessage, ...remainingMessages] = snapshots;
  const tps = session.tokensPerSecond;
  let previousText =
    typeof initialMessage.content === "string" ? initialMessage.content : "";
  return {
    session: setDebugSessionStreaming(
      appendMessages(session, [initialMessage]),
      true,
    ),
    stream: {
      chunks: remainingMessages.map(message => {
        const nextText =
          typeof message.content === "string" ? message.content : "";
        const appendedText = nextText.slice(previousText.length);
        previousText = nextText;
        return {
          delayMs: delayForTokens(countApproxTokens(appendedText), tps),
          message,
        };
      }),
    },
  };
}

/**
 * Build a streaming plan that walks through a precomputed list of message
 * snapshots, optionally after a set of `initialMessages`. `stageTexts` is
 * used to compute the per-chunk delay from the approximate token count of
 * the newly revealed content.
 */
export function buildSnapshotStream(
  session: DebugSession,
  initialMessages: readonly RpcTranscriptMessage[],
  snapshots: readonly RpcTranscriptMessage[],
  stageTexts: readonly string[],
): DebugPromptResult {
  const [initialSnapshot, ...remainingSnapshots] = snapshots;
  return {
    session: setDebugSessionStreaming(
      appendMessages(session, [...initialMessages, initialSnapshot]),
      true,
    ),
    stream: {
      chunks: remainingSnapshots.map((message, index) => ({
        delayMs: delayForTokens(
          countApproxTokens(
            stageTexts[index] ??
              JSON.stringify(message.content ?? message.errorMessage ?? ""),
          ),
          session.tokensPerSecond,
        ),
        message,
      })),
    },
  };
}

/**
 * Generate the snapshot list for a plain-text progressive stream. Each
 * snapshot contains the first `end` lines joined as a single string.
 */
export function buildProgressiveTextMessages(
  lines: readonly string[],
  messageId: string,
  linesPerChunk: number,
): RpcTranscriptMessage[] {
  const snapshots: RpcTranscriptMessage[] = [];
  for (let end = linesPerChunk; end < lines.length; end += linesPerChunk) {
    snapshots.push(
      materializeMessage({
        id: messageId,
        role: "assistant",
        content: lines.slice(0, end).join("\n"),
      }),
    );
  }
  return snapshots;
}

export type { DebugPromptResult, DebugStreamPlan };