import type {
  RpcJsonObject,
  RpcJsonValue,
  RpcToolArguments,
  RpcToolResultDetails,
  RpcTranscriptMessage,
} from "@pi-web/bridge/types";

export type JsonObject = RpcJsonObject;
export type JsonValue = RpcJsonValue;

export type TranscriptEntryLike = RpcTranscriptMessage;

export type ToolBlockStatus = "pending" | "success" | "error";

export interface TextContentBlock {
  kind: "text";
  text: string;
}

export interface ToolContentBlock {
  kind: "tool";
  toolName: string;
  toolCallId?: string;
  toolArgs: RpcToolArguments | undefined;
  argumentsText: string;
  resultText?: string;
  resultBlocks?: ToolResultBlock[];
  resultDetails?: RpcToolResultDetails;
  resultSourceMessageId?: string;
  toolStatus: ToolBlockStatus;
}

export interface ThinkingContentBlock {
  kind: "thinking";
  text: string;
}

export interface ImageContentBlock {
  kind: "image";
  src: string;
  alt: string;
  mimeType?: string;
}

export type ToolResultBlock = TextContentBlock | ImageContentBlock;

export type SystemBlockType =
  | "compaction"
  | "branch_summary"
  | "model_change"
  | "thinking_level_change"
  | "session_info";

export interface SystemContentBlock {
  kind: "system";
  systemType: SystemBlockType;
  label: string;
  title: string;
  body?: string;
  meta?: string;
}

export type ContentBlock =
  | TextContentBlock
  | ToolContentBlock
  | ThinkingContentBlock
  | ImageContentBlock
  | SystemContentBlock;

export interface TranscriptMessageDisplayItem {
  kind: "message";
  message: TranscriptEntryLike;
  messageIndex: number;
}

export interface TranscriptSessionEventDisplayItem {
  kind: "session_event";
  key: string;
  label: string;
  model?: {
    provider?: string;
    id: string;
  };
  thinkingLevel?: string;
  sourceMessageIds: string[];
}

export interface PendingTranscriptSessionEvent {
  key: string;
  model?: {
    provider?: string;
    id: string;
  };
  thinkingLevel?: string;
  insertAfterMessageKey?: string | null;
}

export interface TranscriptConfigState {
  model?: {
    provider?: string;
    id: string;
  };
  thinkingLevel?: string;
}

export type TranscriptDisplayItem =
  | TranscriptMessageDisplayItem
  | TranscriptSessionEventDisplayItem;