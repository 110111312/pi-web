import type {
  RpcTranscriptContent,
  RpcTranscriptContentBlock,
  RpcTranscriptMessage,
} from "@pi-web/bridge/types";

import { materializeMessage } from "./debugSessionMessages";
import { assistantMessage } from "./debugSessionMessages";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isContentBlockLike(
  value: unknown,
): value is RpcTranscriptContentBlock {
  return isRecord(value) && typeof value.type === "string";
}

export function isMessageLike(
  value: unknown,
): value is Partial<RpcTranscriptMessage> {
  return isRecord(value) && typeof value.role === "string";
}

export function normalizeMessageLike(
  value: Partial<RpcTranscriptMessage>,
): RpcTranscriptMessage {
  if (!value.role?.trim()) {
    throw new Error("Debug JSON message is missing a role.");
  }

  const content = value.content;
  const text = typeof value.text === "string" ? value.text : undefined;
  if (
    content !== undefined &&
    typeof content !== "string" &&
    !Array.isArray(content)
  ) {
    throw new Error("Debug JSON message content must be a string or an array.");
  }
  if (
    content === undefined &&
    text === undefined &&
    value.errorMessage === undefined
  ) {
    throw new Error(
      "Debug JSON message must provide content, text, or errorMessage.",
    );
  }

  return materializeMessage({
    role: value.role,
    content,
    text,
    stopReason: value.stopReason,
    errorMessage: value.errorMessage,
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    isError: value.isError,
    details: value.details,
    id: value.id,
    transcriptKey: value.transcriptKey,
    timestamp: value.timestamp,
  });
}

export function normalizeJsonMessages(payload: unknown): RpcTranscriptMessage[] {
  if (typeof payload === "string") {
    return [assistantMessage(payload)];
  }

  if (Array.isArray(payload)) {
    if (payload.every(isMessageLike)) {
      return payload.map(message => normalizeMessageLike(message));
    }
    if (
      payload.every(
        item => typeof item === "string" || isContentBlockLike(item),
      )
    ) {
      return [
        materializeMessage({
          role: "assistant",
          content: payload as RpcTranscriptContent,
        }),
      ];
    }
    throw new Error(
      "Debug JSON array must contain transcript messages or content blocks.",
    );
  }

  if (isMessageLike(payload)) {
    return [normalizeMessageLike(payload)];
  }

  if (isContentBlockLike(payload)) {
    return [materializeMessage({ role: "assistant", content: [payload] })];
  }

  if (isRecord(payload) && Array.isArray(payload.messages)) {
    return normalizeJsonMessages(payload.messages);
  }

  if (isRecord(payload) && isMessageLike(payload.message)) {
    return [normalizeMessageLike(payload.message)];
  }

  throw new Error(
    "Debug JSON payload must be a transcript message, a messages array, or raw content blocks.",
  );
}