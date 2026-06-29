// Public API entry point for the debug-session subsystem.
//
// This module intentionally re-exports the public surface from the split
// implementation files so existing callers can keep importing from
// `@pi-web/svelte/debugSession`. Only `applyDebugPrompt` is defined here
// because it composes helpers from every other module.

import type { RpcImageContent } from "@pi-web/bridge/types";

import {
  appendMessages,
  assistantMessage,
  errorMessage,
  resetTranscript,
  userMessage,
} from "./debugSessionMessages";

import { normalizeJsonMessages } from "./debugSessionJson";
import {
  streamingFixtureResult,
} from "./debugSessionProgressiveMixedError";
import {
  renameDebugSession,
  setDebugSessionTps,
} from "./debugSessionSession";
import { parseDebugTps, trimCommandArgument } from "./debugSessionTokens";

// Re-export the public surface so existing imports keep working.
export {
  DEBUG_WORKSPACE_ID,
  DEBUG_WORKSPACE_NAME,
  DEBUG_WORKSPACE_PATH,
  DEFAULT_DEBUG_TPS,
  type DebugPromptResult,
  type DebugSession,
  type DebugStreamChunk,
  type DebugStreamPlan,
} from "./debugSessionTypes";

export {
  isDebugSessionPath,
  createDebugWorkspaceSummary,
  createDebugSessionEntry,
  createDebugSession,
  renameDebugSession,
  setDebugSessionModel,
  setDebugSessionThinkingLevel,
  setDebugSessionAutoCompaction,
  setDebugSessionTps,
  debugSessionModelInfo,
} from "./debugSessionSession";

export { replaceDebugSessionMessage, setDebugSessionStreaming } from "./debugSessionMessages";

export function applyDebugPrompt(
  session: DebugSession,
  input: string,
  images: readonly RpcImageContent[] = [],
): DebugPromptResult {
  const trimmed = input.trim();
  if (!trimmed && images.length === 0) return { session };

  try {
    const commandMatch = trimmed.match(/^\/([a-z-]+)(?:\s+([\s\S]*))?$/);
    if (commandMatch) {
      const command = commandMatch[1]!.toLowerCase();
      const body = commandMatch[2] ?? "";

      switch (command) {
        case "assistant":
          return {
            session: appendMessages(session, [
              assistantMessage(
                trimCommandArgument(body, "Assistant content cannot be empty."),
                images,
              ),
            ]),
          };
        case "user":
          return {
            session: appendMessages(session, [
              userMessage(
                trimCommandArgument(body, "User content cannot be empty."),
                images,
              ),
            ]),
          };
        case "fixture": {
          const fixtureName = trimCommandArgument(
            body,
            "Fixture name is required.",
          );
          const streamingResult = streamingFixtureResult(session, fixtureName);
          if (streamingResult) return streamingResult;
          throw new Error(
            "Unknown debug fixture. Use markdown, tool-read, tool-bash, tool-edit, tool-write, mixed, or error.",
          );
        }
        case "json": {
          const jsonPayload = trimCommandArgument(
            body,
            "JSON payload is required.",
          );
          return {
            session: appendMessages(
              session,
              normalizeJsonMessages(JSON.parse(jsonPayload) as unknown),
            ),
          };
        }
        case "tps":
          return {
            session: setDebugSessionTps(
              session,
              parseDebugTps(
                trimCommandArgument(body, "TPS value is required."),
              ),
            ),
          };
        case "name":
          return { session: renameDebugSession(session, body) };
        case "clear":
        case "reset":
          return { session: resetTranscript(session) };
        default:
          throw new Error(
            "Unknown debug command. Use /assistant, /user, /fixture, /json, /tps, /name, or /clear.",
          );
      }
    }

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return {
        session: appendMessages(
          session,
          normalizeJsonMessages(JSON.parse(trimmed) as unknown),
        ),
      };
    }

    return {
      session: appendMessages(session, [assistantMessage(trimmed, images)]),
    };
  } catch (error) {
    return {
      session: appendMessages(session, [
        errorMessage(error instanceof Error ? error.message : String(error)),
      ]),
    };
  }
}