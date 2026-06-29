import type {
  RpcExtensionUIRequest,
  RpcGitBranch,
  RpcGitRepoState,
  RpcImageContent,
  RpcQueuedMessage,
  RpcSessionStats,
  RpcThinkingLevel,
  RpcTranscriptDeltaEvent,
  RpcTranscriptMessage,
  RpcTranscriptStartEvent,
  RpcTreeEntry,
  RpcWorkspaceSummary,
} from "@pi-web/bridge/types";
import {
  normalizeTranscript,
  transcriptConfigState,
  type PendingTranscriptSessionEvent,
} from "../../utils/transcript";

// ---------------------------------------------------------------------------
// Public type aliases (re-exported from bridgeStore.svelte.ts)
// ---------------------------------------------------------------------------

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type TranscriptEntry = RpcTranscriptMessage;
export type TranscriptDelta = RpcTranscriptDeltaEvent;
export type TranscriptStream = RpcTranscriptStartEvent;
export type TreeEntry = RpcTreeEntry;

export interface SessionEntry {
  id: string;
  name: string;
  path: string;
  isRunning?: boolean;
  timestamp?: string;
  updatedAt?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspacePath?: string;
  parentSession?: string;
}

export type WorkspaceSummary = RpcWorkspaceSummary;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export type DialogExtensionUIRequest = Extract<
  RpcExtensionUIRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;

export type PendingDisplayTranscriptDelta = {
  payload: Omit<TranscriptDelta, "delta">;
  pendingText: string;
  pendingUnits: number;
  queuedAt: number;
  started: boolean;
};

type TranscriptConfigSnapshot = ReturnType<typeof transcriptConfigState>;

export const normalizeTranscriptEntries = normalizeTranscript as (
  messages: readonly unknown[],
) => TranscriptEntry[];

export const readTranscriptConfigState = transcriptConfigState as (
  messages: readonly unknown[],
) => TranscriptConfigSnapshot;

// ---------------------------------------------------------------------------
// Pure normalization helpers
// ---------------------------------------------------------------------------

export function readFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeSessionStats(value: unknown): RpcSessionStats | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<RpcSessionStats>;
  return {
    tokens:
      typeof data.tokens === "number" && Number.isFinite(data.tokens)
        ? data.tokens
        : null,
    contextWindow: readFiniteNumber(data.contextWindow),
    percent:
      typeof data.percent === "number" && Number.isFinite(data.percent)
        ? data.percent
        : null,
    messageCount: readFiniteNumber(data.messageCount),
    cost: readFiniteNumber(data.cost),
    inputTokens: readFiniteNumber(data.inputTokens),
    outputTokens: readFiniteNumber(data.outputTokens),
    cacheReadTokens: readFiniteNumber(data.cacheReadTokens),
    cacheWriteTokens: readFiniteNumber(data.cacheWriteTokens),
  };
}

export function normalizeGitBranch(value: unknown): RpcGitBranch | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<RpcGitBranch>;
  if (typeof data.name !== "string" || typeof data.shortName !== "string") {
    return null;
  }
  if (data.kind !== "local" && data.kind !== "remote") {
    return null;
  }

  return {
    name: data.name,
    shortName: data.shortName,
    kind: data.kind,
    remoteName:
      typeof data.remoteName === "string" ? data.remoteName : undefined,
    isCurrent: data.isCurrent === true,
  };
}

export function normalizeGitRepoState(value: unknown): RpcGitRepoState | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<RpcGitRepoState>;
  if (typeof data.repoRoot !== "string" || typeof data.headLabel !== "string") {
    return null;
  }

  const branches = Array.isArray(data.branches)
    ? data.branches
        .map(branch => normalizeGitBranch(branch))
        .filter((branch): branch is RpcGitBranch => branch !== null)
    : [];

  return {
    repoRoot: data.repoRoot,
    headLabel: data.headLabel,
    currentBranch:
      typeof data.currentBranch === "string" ? data.currentBranch : undefined,
    detached: data.detached === true,
    isDirty: data.isDirty === true,
    branches,
  };
}

export function normalizeQueuedMessage(value: unknown): RpcQueuedMessage | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<RpcQueuedMessage>;
  if (typeof data.text !== "string") {
    return null;
  }

  const images = Array.isArray(data.images)
    ? data.images.filter(
        (image): image is RpcImageContent =>
          Boolean(image) &&
          image.type === "image" &&
          typeof image.data === "string" &&
          typeof image.mimeType === "string",
      )
    : [];

  return {
    text: data.text,
    images,
    timestamp:
      typeof data.timestamp === "number" && Number.isFinite(data.timestamp)
        ? data.timestamp
        : Date.now(),
    queueType: data.queueType === "steering" ? "steering" : "followUp",
  };
}

export function normalizeThinkingLevel(value: unknown): RpcThinkingLevel | null {
  switch (value) {
    case "normal":
    case "medium":
      return "medium";
    case "off":
    case "minimal":
    case "low":
    case "high":
    case "xhigh":
      return value;
    default:
      return null;
  }
}

export function summarizeErrorMessage(message: unknown, fallback: string): string {
  if (typeof message !== "string") return fallback;
  const line = message
    .split(/\r?\n/)
    .map(part => part.trim())
    .find(Boolean);
  if (!line) return fallback;
  return line.length > 220 ? `${line.slice(0, 217)}...` : line;
}