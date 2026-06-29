import type {
  RpcTranscriptContent,
  RpcTranscriptContentBlock,
  RpcTranscriptImageBlock,
  RpcTranscriptImageUrlBlock,
  RpcTranscriptSystemBlock,
  RpcTranscriptToolResultBlock,
} from "@pi-web/bridge/types";
import type {
  JsonObject,
  TranscriptEntryLike,
} from "./transcriptTypes";

type TranscriptContentItem =
  | string
  | (RpcTranscriptContentBlock & { sourceMessageId?: string });

export type { TranscriptContentItem };

export interface TranscriptToolResultBlockWithSource
  extends RpcTranscriptToolResultBlock {
  sourceMessageId?: string;
}

type TranscriptImageBlock =
  | RpcTranscriptImageBlock
  | RpcTranscriptImageUrlBlock;

export function isSystemBlock(
  block: RpcTranscriptContentBlock,
): block is RpcTranscriptSystemBlock {
  return (
    block.type === "compaction" ||
    block.type === "branch_summary" ||
    block.type === "model_change" ||
    block.type === "thinking_level_change" ||
    block.type === "session_info"
  );
}

export function isHiddenSystemBlock(block: RpcTranscriptSystemBlock): boolean {
  return block.type === "session_info";
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeOptionalText(
  value: string | undefined,
): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

export function normalizeText(
  value: string | undefined,
  fallback: string,
): string {
  return normalizeOptionalText(value) ?? fallback;
}

export function cloneMessage(
  message: TranscriptEntryLike,
): TranscriptEntryLike {
  return {
    ...message,
    content: cloneContent(message.content),
  };
}

export function cloneContent(
  content: RpcTranscriptContent | undefined,
): RpcTranscriptContent | undefined {
  if (!Array.isArray(content)) return content;
  return content.map(cloneContentItem);
}

export function cloneContentItem(
  block: TranscriptContentItem,
): TranscriptContentItem {
  if (typeof block === "string") return block;
  return { ...block };
}

export function cloneToolResultContent(
  content: RpcTranscriptContent | undefined,
): RpcTranscriptToolResultBlock["content"] | undefined {
  if (!Array.isArray(content)) return undefined;

  const cloned: NonNullable<RpcTranscriptToolResultBlock["content"]> = [];
  for (const item of content) {
    if (typeof item === "string") {
      cloned.push(item);
      continue;
    }

    switch (item.type) {
      case "text":
      case "image":
      case "image_url":
        cloned.push({ ...item });
        break;
      default:
        break;
    }
  }

  return cloned;
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M tokens`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k tokens`;
  return `${count} tokens`;
}

export function transcriptMessageKey(
  message: TranscriptEntryLike | undefined,
  index: number,
): string {
  if (!message) return `message:${index}`;
  return message.transcriptKey ?? message.id ?? `message:${index}`;
}

export function imageBlockSource(block: TranscriptImageBlock): string | null {
  switch (block.type) {
    case "image":
      if (
        typeof block.data === "string" &&
        typeof block.mimeType === "string"
      ) {
        return `data:${block.mimeType};base64,${block.data}`;
      }
      return typeof block.url === "string" ? block.url : null;
    case "image_url":
      if (typeof block.url === "string") {
        return block.url;
      }
      if (typeof block.image_url === "string") {
        return block.image_url;
      }
      if (
        typeof block.image_url === "object" &&
        block.image_url !== null &&
        typeof block.image_url.url === "string"
      ) {
        return block.image_url.url;
      }
      return null;
  }
}