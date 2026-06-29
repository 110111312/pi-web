import type {
  RpcImageContent,
  RpcTranscriptContentBlock,
  RpcTranscriptMessage,
} from "@pi-web/bridge/types";

import {
  clampDebugTps,
} from "./debugSessionTokens";
import {
  contentFromTextAndImages,
  DEFAULT_DEBUG_TPS,
  type DebugSession,
  materializeMessage,
  nextDebugId,
  nowIso,
} from "./debugSessionTypes";

export function materializeMessage(
  message: Omit<RpcTranscriptMessage, "id" | "transcriptKey" | "timestamp"> & {
    id?: string;
    transcriptKey?: string;
    timestamp?: string;
  },
): RpcTranscriptMessage {
  const id = message.id?.trim() || nextDebugId("msg");
  return {
    ...message,
    id,
    transcriptKey: message.transcriptKey?.trim() || id,
    timestamp: message.timestamp?.trim() || nowIso(),
  };
}

export function assistantMessage(
  text: string,
  images: readonly RpcImageContent[] = [],
): RpcTranscriptMessage {
  return materializeMessage({
    role: "assistant",
    content: contentFromTextAndImages(text, images),
  });
}

export function userMessage(
  text: string,
  images: readonly RpcImageContent[] = [],
): RpcTranscriptMessage {
  return materializeMessage({
    role: "user",
    content: contentFromTextAndImages(text, images),
  });
}

export function systemMessage(
  block: RpcTranscriptContentBlock,
): RpcTranscriptMessage {
  return materializeMessage({ role: "system", content: [block] });
}

export function errorMessage(message: string): RpcTranscriptMessage {
  return materializeMessage({
    role: "assistant",
    stopReason: "error",
    errorMessage: message,
  });
}

export function introMessage(
  sessionName: string,
  backingWorkspacePath?: string,
  tokensPerSecond: number = DEFAULT_DEBUG_TPS,
): RpcTranscriptMessage {
  const workspaceLine = backingWorkspacePath
    ? `- Bound workspace: \`${backingWorkspacePath}\``
    : "- No workspace bound for file reads or workspace entry lookup.";

  return assistantMessage(
    [
      `# ${sessionName}`,
      "This session stays in memory only and never sends a real LLM request.",
      "",
      "- Plain submit appends an assistant Markdown message.",
      "- `/assistant <markdown>` appends assistant content.",
      "- `/user <text>` appends a user message.",
      "- `/fixture markdown|tool-read|tool-bash|tool-edit|tool-write|mixed|error` inserts samples.",
      "- `/tps <number>` sets the local debug streaming speed.",
      `- Current debug stream speed: ${clampDebugTps(tokensPerSecond)} TPS.`,
      "- `/json <payload>` appends transcript message JSON or raw content block JSON.",
      "- `/name <title>` renames the session.",
      "- `/clear` resets the transcript to this help message.",
      workspaceLine,
    ].join("\n"),
  );
}

export function syncSession(
  session: DebugSession,
  overrides: Partial<DebugSession> = {},
): DebugSession {
  const name = overrides.name?.trim() || session.name;
  const transcript = overrides.transcript ?? session.transcript;
  const sessionState = overrides.sessionState ?? session.sessionState;
  const tokensPerSecond = clampDebugTps(
    typeof overrides.tokensPerSecond === "number"
      ? overrides.tokensPerSecond
      : session.tokensPerSecond,
  );

  return {
    ...session,
    ...overrides,
    name,
    transcript,
    updatedAt: nowIso(),
    tokensPerSecond,
    sessionState: {
      ...sessionState,
      sessionId: session.id,
      sessionName: name,
      sessionFile: session.path,
      workspacePath: session.backingWorkspacePath,
      isStreaming: sessionState.isStreaming === true,
      isCompacting: sessionState.isCompacting === true,
      messageCount: transcript.length,
      pendingMessageCount: 0,
      autoCompactionEnabled: sessionState.autoCompactionEnabled ?? false,
    },
  };
}

export function setDebugSessionStreaming(
  session: DebugSession,
  isStreaming: boolean,
): DebugSession {
  return syncSession(session, {
    sessionState: {
      ...session.sessionState,
      isStreaming,
    },
  });
}

export function resetTranscript(session: DebugSession): DebugSession {
  return setDebugSessionStreaming(
    syncSession(session, {
      transcript: [
        introMessage(
          session.name,
          session.backingWorkspacePath,
          session.tokensPerSecond,
        ),
      ],
    }),
    false,
  );
}

export function appendMessages(
  session: DebugSession,
  messages: readonly RpcTranscriptMessage[],
): DebugSession {
  if (messages.length === 0) return session;
  return syncSession(session, {
    transcript: [...session.transcript, ...messages],
  });
}

export function replaceDebugSessionMessage(
  session: DebugSession,
  message: RpcTranscriptMessage,
): DebugSession {
  const messageId = message.id?.trim();
  if (!messageId) return session;
  const transcript = session.transcript.map(entry =>
    entry.id === messageId ? { ...message } : entry,
  );
  return syncSession(session, { transcript });
}