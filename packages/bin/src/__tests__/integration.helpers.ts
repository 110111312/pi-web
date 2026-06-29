/**
 * Shared helpers for integration tests.
 *
 * Provides a mock Pi extension context, bridge lifecycle helpers, and
 * WebSocket utilities used by the split integration test files.
 */

import * as crypto from "node:crypto";
import { afterEach, beforeEach, vi } from "vitest";
import { WebSocket } from "ws";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { BridgeEvent } from "@pi-web/bridge/types";
import type { WsRpcAdapterContext } from "@pi-web/bridge/ws-rpc-adapter";
import {
  createBridgeSessionActions,
  createBridgeSessionEvents,
  createBridgeSessionState,
} from "../pi-live-session.js";
import type { BridgeController } from "../lifecycle.js";

/** Default timeout for async test operations. */
export const TEST_TIMEOUT = 10000;

/** Connection timeout for WebSocket handshakes and command responses. */
export const WS_CONNECT_TIMEOUT_MS = 5000;
/** Brief wait used to let async event propagation settle. */
export const SHORT_SETTLE_MS = 100;
/** Longer wait used to let shutdown / SIGINT handling settle. */
export const LONG_SETTLE_MS = 200;

/** Create a mock Pi extension context wired into bridge session factories. */
export const createMockContext = (): WsRpcAdapterContext => {
  const sessionManager = {
    getCwd: vi.fn().mockReturnValue("/test/project"),
    getSessionDir: vi.fn().mockReturnValue("/test"),
    getSessionId: vi.fn().mockReturnValue("test-session-123"),
    getSessionFile: vi.fn().mockReturnValue("/test/session.json"),
    getLeafId: vi.fn().mockReturnValue(null),
    getLeafEntry: vi.fn().mockReturnValue(undefined),
    getEntry: vi.fn().mockReturnValue(undefined),
    getLabel: vi.fn().mockReturnValue(undefined),
    getBranch: vi.fn().mockReturnValue([
      { id: "entry-1", role: "user", type: "message", content: "Hello" },
      {
        id: "entry-2",
        role: "assistant",
        type: "message",
        content: "Hi there!",
      },
    ]),
    getHeader: vi.fn().mockReturnValue(null),
    getEntries: vi.fn().mockReturnValue([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ]),
    getTree: vi.fn().mockReturnValue([]),
    getSessionName: vi.fn().mockReturnValue("Test Session"),
  };

  const model = {
    id: "test-model",
    name: "Test Model",
    api: "openai-responses",
    provider: "test",
    baseUrl: "https://example.com",
    reasoning: true,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 1000,
  };

  const pi = {
    sendUserMessage: vi.fn(),
    setModel: vi.fn().mockResolvedValue(true),
    setThinkingLevel: vi.fn(),
    getThinkingLevel: vi.fn().mockReturnValue("medium"),
    setSessionName: vi.fn(),
    getSessionName: vi.fn().mockReturnValue("Test Session"),
    getCommands: vi
      .fn()
      .mockReturnValue([
        { name: "/test", description: "Test command", source: "extension" },
      ]),
    on: vi.fn(),
  } as unknown as ExtensionAPI;

  const ctx = {
    sessionManager,
    model,
    modelRegistry: {
      getAvailable: vi.fn().mockReturnValue([
        { ...model, id: "model-a", name: "Model A" },
        { ...model, id: "model-b", name: "Model B" },
      ]),
    } as unknown as ExtensionCommandContext["modelRegistry"],
    isIdle: vi.fn().mockReturnValue(true),
    signal: undefined,
    abort: vi.fn(),
    compact: vi.fn(),
    shutdown: vi.fn(),
    hasPendingMessages: vi.fn().mockReturnValue(false),
    getContextUsage: vi.fn().mockReturnValue({
      tokens: 100,
      contextWindow: 1000,
      percent: 10,
    }),
    getSystemPrompt: vi.fn().mockReturnValue("test system prompt"),
    cwd: "/test/project",
    ui: {
      custom: vi.fn(),
    },
    hasUI: true,
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    newSession: vi.fn().mockResolvedValue({ cancelled: false }),
    fork: vi.fn().mockResolvedValue({ cancelled: false }),
    navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
    reload: vi.fn().mockResolvedValue(undefined),
  } as unknown as ExtensionCommandContext;

  return {
    events: createBridgeSessionEvents(pi),
    state: createBridgeSessionState(ctx, pi),
    actions: createBridgeSessionActions(pi, ctx),
  };
};

/** Per-test mutable bridge state. Tests reset these in beforeEach. */
export interface BridgeTestState {
  mockContext: WsRpcAdapterContext;
  controller: BridgeController | undefined;
  events: BridgeEvent[];
}

/** Capture original SIGINT listeners so tests can safely emit SIGINT. */
const originalSigintListeners: Array<NodeJS.SignalsListener> = [];

/**
 * Wire up the shared beforeEach/afterEach for integration tests. Call once
 * at the top of each split test file (outside any describe block).
 */
export function installBridgeTestLifecycle(state: BridgeTestState): void {
  beforeEach(() => {
    state.mockContext = createMockContext();
    state.events = [];

    const listeners = process.listeners("SIGINT");
    originalSigintListeners.length = 0;
    originalSigintListeners.push(...(listeners as NodeJS.SignalsListener[]));
    listeners.forEach(l =>
      process.off("SIGINT", l as NodeJS.SignalsListener),
    );
  });

  afterEach(async () => {
    if (state.controller?.getState().status === "running") {
      await state.controller.stop();
    }
    state.controller = undefined;

    process.removeAllListeners("SIGINT");
    originalSigintListeners.forEach(l =>
      process.on("SIGINT", l as NodeJS.SignalsListener),
    );
  });
}

/** Open a WebSocket to the running bridge, waiting for the handshake. */
export function openBridgeWebSocket(
  controller: BridgeController,
  timeoutMs = WS_CONNECT_TIMEOUT_MS,
): Promise<WebSocket> {
  const address = controller.getState();
  if (address.status !== "running") {
    return Promise.reject(new Error("Bridge not running"));
  }
  const wsUrl = `ws://${address.host}:${address.port}/ws`;
  const ws = new WebSocket(wsUrl);

  return new Promise<WebSocket>((resolve, reject) => {
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
    setTimeout(() => reject(new Error("Connection timeout")), timeoutMs);
  });
}

/** Close a WebSocket and wait briefly for the server to register it. */
export function closeBridgeWebSocket(ws: WebSocket): Promise<void> {
  ws.close();
  return new Promise(resolve => setTimeout(resolve, SHORT_SETTLE_MS));
}

/**
 * Wait for a response on the given socket matching `commandId`. Resolves
 * with the parsed response payload.
 */
export function awaitResponse(
  ws: WebSocket,
  commandId: string,
  timeoutMs = WS_CONNECT_TIMEOUT_MS,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Response timeout")),
      timeoutMs,
    );
    ws.on("message", data => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "response" && msg.payload?.id === commandId) {
          clearTimeout(timer);
          resolve(msg.payload);
        }
      } catch {
        /* ignore parse errors */
      }
    });
  });
}

/**
 * Send an RPC command and wait for the response. Auto-assigns an id when
 * one is not present in the payload.
 */
export function sendRpcCommand(
  ws: WebSocket,
  cmd: { type: string; id?: string; [key: string]: unknown },
  timeoutMs = WS_CONNECT_TIMEOUT_MS,
): Promise<unknown> {
  const cmdId = cmd.id ?? crypto.randomUUID();
  const responsePromise = awaitResponse(ws, cmdId, timeoutMs);
  ws.send(
    JSON.stringify({
      type: "command",
      payload: { ...cmd, id: cmdId },
    }),
  );
  return responsePromise;
}