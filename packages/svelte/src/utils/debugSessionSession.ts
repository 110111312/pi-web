import type { RpcModel, RpcThinkingLevel, RpcWorkspaceSummary } from "@pi-web/bridge/types";

import type { SessionEntry } from "../composables/bridgeStore.svelte";
import {
  appendMessages,
  assistantMessage,
  introMessage,
  syncSession,
  systemMessage,
} from "./debugSessionMessages";
import { clampDebugTps, trimCommandArgument } from "./debugSessionTokens";
import type { RpcModelInfo } from "./models";
import {
  bumpDebugSessionCounter,
  DEBUG_WORKSPACE_ID,
  DEBUG_WORKSPACE_NAME,
  DEBUG_WORKSPACE_PATH,
  DEFAULT_DEBUG_TPS,
  type DebugSession,
  normalizeModel,
  nowIso,
} from "./debugSessionTypes";

export function isDebugSessionPath(path: string | null | undefined): boolean {
  return typeof path === "string" && path.startsWith("debug://session/");
}

export function createDebugWorkspaceSummary(): RpcWorkspaceSummary {
  return {
    id: DEBUG_WORKSPACE_ID,
    name: DEBUG_WORKSPACE_NAME,
    path: DEBUG_WORKSPACE_PATH,
    updatedAt: nowIso(),
  };
}

export function createDebugSessionEntry(session: DebugSession): SessionEntry {
  return {
    id: session.id,
    name: session.name,
    path: session.path,
    timestamp: session.updatedAt,
    updatedAt: session.updatedAt,
    workspaceId: DEBUG_WORKSPACE_ID,
    workspaceName: DEBUG_WORKSPACE_NAME,
    workspacePath: DEBUG_WORKSPACE_PATH,
    isRunning: session.sessionState.isStreaming,
  };
}

export function createDebugSession(
  options: {
    model?: RpcModel | null;
    thinkingLevel?: RpcThinkingLevel | null;
    backingWorkspacePath?: string | null;
    backingWorkspaceName?: string | null;
  } = {},
): DebugSession {
  const sessionNumber = bumpDebugSessionCounter();
  const id = `debug-session-${sessionNumber}`;
  const path = `debug://session/${sessionNumber}`;
  const name = `Debug Session ${sessionNumber}`;
  const model = normalizeModel(options.model);
  const thinkingLevel = options.thinkingLevel ?? "medium";
  const backingWorkspacePath =
    options.backingWorkspacePath?.trim() || undefined;
  const session: DebugSession = {
    id,
    path,
    name,
    updatedAt: nowIso(),
    transcript: [introMessage(name, backingWorkspacePath, DEFAULT_DEBUG_TPS)],
    tokensPerSecond: DEFAULT_DEBUG_TPS,
    backingWorkspacePath,
    backingWorkspaceName: options.backingWorkspaceName?.trim() || undefined,
    sessionState: {
      model,
      thinkingLevel,
      isStreaming: false,
      isCompacting: false,
      steeringMode: "all",
      followUpMode: "all",
      sessionFile: path,
      sessionId: id,
      sessionName: name,
      workspacePath: backingWorkspacePath,
      autoCompactionEnabled: false,
      messageCount: 1,
      pendingMessageCount: 0,
    },
  };

  return syncSession(session);
}

export function renameDebugSession(
  session: DebugSession,
  name: string,
): DebugSession {
  const nextName = trimCommandArgument(
    name,
    "Debug session name cannot be empty.",
  );
  return syncSession(session, { name: nextName });
}

export function setDebugSessionModel(
  session: DebugSession,
  model?: RpcModel | null,
): DebugSession {
  const normalized = normalizeModel(model);
  const next = syncSession(session, {
    sessionState: {
      ...session.sessionState,
      model: normalized,
    },
  });
  if (!normalized) return next;
  return appendMessages(next, [
    systemMessage({
      type: "model_change",
      provider: normalized.provider,
      modelId: normalized.id,
    }),
  ]);
}

export function setDebugSessionThinkingLevel(
  session: DebugSession,
  thinkingLevel: RpcThinkingLevel,
): DebugSession {
  const next = syncSession(session, {
    sessionState: {
      ...session.sessionState,
      thinkingLevel,
    },
  });
  return appendMessages(next, [
    systemMessage({
      type: "thinking_level_change",
      thinkingLevel,
    }),
  ]);
}

export function setDebugSessionAutoCompaction(
  session: DebugSession,
  enabled: boolean,
): DebugSession {
  return syncSession(session, {
    sessionState: {
      ...session.sessionState,
      autoCompactionEnabled: enabled,
    },
  });
}

export function setDebugSessionTps(
  session: DebugSession,
  tokensPerSecond: number,
): DebugSession {
  const nextTps = clampDebugTps(tokensPerSecond);
  return appendMessages(syncSession(session, { tokensPerSecond: nextTps }), [
    assistantMessage(`Debug stream speed set to ${nextTps} TPS.`),
  ]);
}

export function debugSessionModelInfo(
  session: DebugSession,
): RpcModelInfo | null {
  const model = session.sessionState.model;
  if (!model?.id || !model.provider) return null;
  return {
    id: model.id,
    provider: model.provider,
    name: model.name ?? model.id,
    api: model.api,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}