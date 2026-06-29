import type {
  RpcImageContent,
  RpcModel,
  RpcSessionState,
  RpcThinkingLevel,
  RpcTranscriptContent,
  RpcTranscriptContentBlock,
  RpcTranscriptMessage,
  RpcWorkspaceSummary,
} from "@pi-web/bridge/types";

export const DEBUG_WORKSPACE_ID = "debug-workspace";
export const DEBUG_WORKSPACE_NAME = "Debug";
export const DEBUG_WORKSPACE_PATH = "debug://workspace";

export const DEFAULT_DEBUG_TPS = 24;
export const MIN_DEBUG_TPS = 1;
export const MAX_DEBUG_TPS = 240;

export interface DebugSession {
  id: string;
  path: string;
  name: string;
  transcript: RpcTranscriptMessage[];
  sessionState: RpcSessionState;
  updatedAt: string;
  tokensPerSecond: number;
  backingWorkspacePath?: string;
  backingWorkspaceName?: string;
}

export interface DebugStreamChunk {
  delayMs: number;
  message: RpcTranscriptMessage;
}

export interface DebugStreamPlan {
  chunks: DebugStreamChunk[];
}

export interface DebugPromptResult {
  session: DebugSession;
  stream?: DebugStreamPlan;
}

// Module-level counters used to mint stable ids and session numbers.
export let debugIdCounter = 0;
export let debugSessionCounter = 0;

export function bumpDebugIdCounter(): number {
  debugIdCounter += 1;
  return debugIdCounter;
}

export function bumpDebugSessionCounter(): number {
  debugSessionCounter += 1;
  return debugSessionCounter;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function nextDebugId(prefix: string): string {
  return `debug-${prefix}-${bumpDebugIdCounter()}`;
}

export function normalizeModel(model?: RpcModel | null): RpcModel | undefined {
  if (!model?.id || !model.provider) return undefined;
  return {
    id: model.id,
    provider: model.provider,
    name: model.name,
    api: model.api,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}

export function contentFromTextAndImages(
  text: string,
  images: readonly RpcImageContent[] = [],
): RpcTranscriptContent | undefined {
  const trimmed = text.trim();
  const blocks: RpcTranscriptContentBlock[] = images.map(image => ({
    type: "image" as const,
    data: image.data,
    mimeType: image.mimeType,
    text: "Debug image",
  }));

  if (trimmed) {
    if (blocks.length === 0) return trimmed;
    return [{ type: "text", text: trimmed }, ...blocks];
  }

  if (blocks.length > 0) return blocks;
  return undefined;
}