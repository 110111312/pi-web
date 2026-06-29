import type {
  RpcTranscriptContent,
  RpcTranscriptContentBlock,
  RpcTranscriptSystemBlock,
  RpcToolArguments,
  RpcTranscriptToolResultBlock,
} from "@pi-web/bridge/types";
import type {
  ContentBlock,
  ToolBlockStatus,
  ToolResultBlock,
  TranscriptEntryLike,
} from "./transcriptTypes";
import {
  cloneContentItem,
  cloneMessage,
  cloneToolResultContent,
  imageBlockSource,
  isHiddenSystemBlock,
  isJsonObject,
  isSystemBlock,
  type TranscriptContentItem,
  type TranscriptToolResultBlockWithSource,
} from "./transcriptUtils";

// Message predicates

export function isErrorMessage(msg: TranscriptEntryLike): boolean {
  if (msg.role !== "assistant") return false;
  return msg.stopReason === "error" || msg.stopReason === "aborted";
}

export function errorMessageText(msg: TranscriptEntryLike): string {
  return msg.errorMessage ?? "";
}

export function isAbortedMessage(msg: TranscriptEntryLike): boolean {
  return msg.stopReason === "aborted";
}

export function isToolResultMessage(msg: TranscriptEntryLike): boolean {
  return msg.role === "toolResult" || msg.role === "tool";
}

export function isSystemMessage(msg: TranscriptEntryLike): boolean {
  return msg.role === "system";
}

// Content extraction

export function messageContent(
  msg: Pick<TranscriptEntryLike, "content" | "text">,
): string {
  const content = msg.content;
  if (typeof content === "string") return content;
  if (typeof msg.text === "string") return msg.text;
  if (!Array.isArray(content)) return "";

  return content.map(contentItemText).filter(Boolean).join("\n");
}

export function contentItemText(block: TranscriptContentItem): string {
  if (typeof block === "string") return block;
  if (isSystemBlock(block)) {
    return isHiddenSystemBlock(block) ? "" : systemBlockText(block);
  }

  switch (block.type) {
    case "text":
      return block.text;
    case "toolResult":
      return toolResultText(block);
    default:
      return "";
  }
}

// Content block conversion

export function contentBlocks(msg: TranscriptEntryLike): ContentBlock[] {
  const content = msg.content;
  const blocks: ContentBlock[] = [];

  if (typeof content === "string") {
    blocks.push({ kind: "text", text: content });
    return blocks;
  }

  if (typeof msg.text === "string") {
    blocks.push({ kind: "text", text: msg.text });
    return blocks;
  }

  if (!Array.isArray(content)) return blocks;

  for (let index = 0; index < content.length; index++) {
    const block = content[index];
    if (typeof block === "string") {
      blocks.push({ kind: "text", text: block });
      continue;
    }

    if (isSystemBlock(block)) {
      if (!isHiddenSystemBlock(block)) {
        blocks.push(systemContentBlock(block));
      }
      continue;
    }

    switch (block.type) {
      case "text":
        blocks.push({ kind: "text", text: block.text });
        continue;
      case "thinking": {
        const thinkingText = block.thinking.trim();
        if (thinkingText) {
          blocks.push({ kind: "thinking", text: thinkingText });
        }
        continue;
      }
      case "toolCall": {
        const nextToolResult = toolResultBlockFromItem(content[index + 1]);
        const resultText = nextToolResult
          ? toolResultText(nextToolResult)
          : undefined;
        const resultBlocks = nextToolResult
          ? toolResultBlocks(nextToolResult)
          : undefined;
        const resultDetails = nextToolResult?.details;
        const resultIsError = nextToolResult?.isError;
        const resultSourceMessageId = nextToolResult?.sourceMessageId;

        blocks.push({
          kind: "tool",
          toolName: block.name ?? "unknown",
          toolCallId: block.id,
          toolArgs: parseToolArguments(block.arguments),
          argumentsText: toolArgumentsText(block.arguments),
          resultText,
          resultBlocks,
          resultDetails,
          resultSourceMessageId,
          toolStatus: toolStatusFromResult(
            resultText,
            resultBlocks,
            resultIsError,
          ),
        });

        if (nextToolResult) {
          index += 1;
        }
        continue;
      }
      case "toolResult":
        blocks.push(...toolResultBlocks(block));
        continue;
      case "image":
      case "image_url": {
        const src = imageBlockSource(block);
        if (src) {
          blocks.push({
            kind: "image",
            src,
            alt: block.text ?? "Image attachment",
            mimeType: block.mimeType,
          });
        } else {
          blocks.push({ kind: "text", text: "[image]" });
        }
        continue;
      }
    }
  }

  return blocks;
}

// Normalization: merge tool results into assistant messages

export function normalizeTranscript(
  messages: readonly TranscriptEntryLike[],
): TranscriptEntryLike[] {
  const normalized: TranscriptEntryLike[] = [];

  for (const message of messages) {
    if (isToolResultMessage(message)) {
      const merged = appendToolResultToPreviousAssistant(normalized, message);
      if (!merged) {
        normalized.push(cloneMessage(message));
      }
      continue;
    }

    normalized.push(cloneMessage(message));
  }

  return normalized;
}

function appendToolResultToPreviousAssistant(
  normalized: TranscriptEntryLike[],
  toolResultMessage: TranscriptEntryLike,
): boolean {
  for (let index = normalized.length - 1; index >= 0; index--) {
    const candidate = normalized[index];
    if (candidate.role !== "assistant") continue;

    const mergedContent = mergeToolResultIntoContent(
      candidate.content,
      toolResultMessage,
    );
    if (!mergedContent) continue;

    normalized[index] = {
      ...candidate,
      content: mergedContent,
    };
    return true;
  }

  return false;
}

function mergeToolResultIntoContent(
  content: RpcTranscriptContent | undefined,
  toolResultMessage: TranscriptEntryLike,
): TranscriptContentItem[] | null {
  if (!Array.isArray(content)) return null;

  const cloned = content.map(cloneContentItem);
  const targetIndex = findNextUnmatchedToolCallIndex(cloned);
  if (targetIndex === -1) return null;

  const toolResultBlock: TranscriptToolResultBlockWithSource = {
    type: "toolResult",
    text: messageContent(toolResultMessage),
    content: cloneToolResultContent(toolResultMessage.content),
    details: toolResultMessage.details,
    isError: toolResultMessage.isError,
    sourceMessageId:
      typeof toolResultMessage.id === "string" && toolResultMessage.id
        ? toolResultMessage.id
        : undefined,
  };

  cloned.splice(targetIndex + 1, 0, toolResultBlock);
  return cloned;
}

function findNextUnmatchedToolCallIndex(
  content: TranscriptContentItem[],
): number {
  const unmatchedToolCallIndexes: number[] = [];

  for (let index = 0; index < content.length; index++) {
    const block = content[index];
    if (typeof block === "string") continue;

    if (block.type === "toolCall") {
      unmatchedToolCallIndexes.push(index);
      continue;
    }
    if (block.type === "toolResult" && unmatchedToolCallIndexes.length > 0) {
      unmatchedToolCallIndexes.shift();
    }
  }

  return unmatchedToolCallIndexes[0] ?? -1;
}

// Tool argument parsing

function parseToolArguments(
  args: RpcToolArguments | undefined,
): RpcToolArguments | undefined {
  if (typeof args !== "string") return args;
  const trimmed = args.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    return isJsonObject(parsed) ? parsed : args;
  } catch {
    return args;
  }
}

function toolArgumentsText(args: RpcToolArguments | undefined): string {
  if (typeof args === "string") return args;
  return JSON.stringify(args ?? "", null, 2);
}

// Tool result extraction

function toolStatusFromResult(
  resultText: string | undefined,
  resultBlocks: ToolResultBlock[] | undefined,
  isError: boolean | undefined,
): ToolBlockStatus {
  const hasText =
    typeof resultText === "string" && resultText.trim().length > 0;
  const hasBlocks = Array.isArray(resultBlocks) && resultBlocks.length > 0;
  if (!hasText && !hasBlocks) return "pending";
  return isError ? "error" : "success";
}

function toolResultBlockFromItem(
  block: TranscriptContentItem | undefined,
): TranscriptToolResultBlockWithSource | undefined {
  if (!block || typeof block === "string" || block.type !== "toolResult") {
    return undefined;
  }
  return block as TranscriptToolResultBlockWithSource;
}

function toolResultText(block: RpcTranscriptToolResultBlock): string {
  if (Array.isArray(block.content)) {
    return block.content
      .map(item => {
        if (typeof item === "string") return item;
        return item.type === "text" ? item.text : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof block.text === "string") return block.text;
  return JSON.stringify(block, null, 2);
}

function toolResultBlocks(
  block: RpcTranscriptToolResultBlock,
): ToolResultBlock[] {
  if (Array.isArray(block.content)) {
    const blocks: ToolResultBlock[] = [];
    for (const item of block.content) {
      if (typeof item === "string") {
        blocks.push({ kind: "text", text: item });
        continue;
      }

      switch (item.type) {
        case "text":
          blocks.push({ kind: "text", text: item.text });
          continue;
        case "image":
        case "image_url": {
          const src = imageBlockSource(item);
          if (src) {
            blocks.push({
              kind: "image",
              src,
              alt: item.text ?? "Image attachment",
              mimeType: item.mimeType,
            });
          }
          continue;
        }
      }
    }

    if (blocks.length > 0) return blocks;
  }

  const text = toolResultText(block);
  return text ? [{ kind: "text", text }] : [];
}

// System block helpers (shared with formatter)

export function systemContentBlock(
  block: RpcTranscriptSystemBlock,
): import("./transcriptTypes").SystemContentBlock {
  switch (block.type) {
    case "compaction": {
      const tokensBefore = Number.isFinite(block.tokensBefore)
        ? block.tokensBefore
        : null;
      return {
        kind: "system",
        systemType: "compaction",
        label: "Compaction",
        title: "Context compacted",
        body: block.summary.trim() ? block.summary.trim() : undefined,
        meta:
          tokensBefore === null ? undefined : formatTokenCount(tokensBefore),
      };
    }
    case "branch_summary":
      return {
        kind: "system",
        systemType: "branch_summary",
        label: "Branch Summary",
        title: "Branch summarized",
        body: block.summary.trim() ? block.summary.trim() : undefined,
      };
    case "model_change": {
      const provider = block.provider.trim()
        ? block.provider.trim()
        : undefined;
      const modelId = block.modelId.trim()
        ? block.modelId.trim()
        : "Unknown model";
      return {
        kind: "system",
        systemType: "model_change",
        label: "Model",
        title: modelId,
        meta: provider,
      };
    }
    case "thinking_level_change": {
      const level = block.thinkingLevel.trim()
        ? block.thinkingLevel.trim()
        : "Unknown";
      return {
        kind: "system",
        systemType: "thinking_level_change",
        label: "Thinking",
        title: level,
      };
    }
    case "session_info": {
      const name = block.name?.trim() ? block.name.trim() : "Untitled session";
      return {
        kind: "system",
        systemType: "session_info",
        label: "Session",
        title: name,
      };
    }
  }
}

function systemBlockText(block: RpcTranscriptSystemBlock): string {
  const contentBlock = systemContentBlock(block);
  return contentBlock.body
    ? `${contentBlock.title}\n${contentBlock.body}`
    : contentBlock.title;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M tokens`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k tokens`;
  return `${count} tokens`;
}