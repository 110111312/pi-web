/**
 * Integration tests for RPC command dispatch (get_state, get_commands,
 * prompt auto-session, and unknown command handling).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BRIDGE_CONFIG } from "@pi-web/bridge/types";
import { startBridge } from "../lifecycle.js";
import {
  TEST_TIMEOUT,
  installBridgeTestLifecycle,
  openBridgeWebSocket,
  awaitResponse,
  type BridgeTestState,
} from "./integration.helpers.js";

const { createAgentSessionMock } = vi.hoisted(() => ({
  createAgentSessionMock: vi.fn(),
}));

vi.mock("@pi-web/bridge/detached-session", () => ({
  createDetachedAgentSession: createAgentSessionMock,
}));

const state: BridgeTestState = {
  mockContext: undefined as never,
  controller: undefined,
  events: [],
};
installBridgeTestLifecycle(state);

beforeEach(() => {
  createAgentSessionMock.mockReset();
});

describe("Bridge Integration: RPC Commands", () => {
  it(
    "should handle get_state command",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);

      const ws = await openBridgeWebSocket(state.controller);

      const commandId = "test-cmd-1";
      ws.send(
        JSON.stringify({
          type: "command",
          payload: { id: commandId, type: "get_state" },
        }),
      );

      const response = (await awaitResponse(ws, commandId)) as Record<
        string,
        unknown
      >;

      expect(response).toMatchObject({
        type: "response",
        command: "get_state",
        success: true,
        data: {
          sessionId: "test-session-123",
          sessionName: "Hello",
          messageCount: 2,
          pendingMessageCount: 0,
          isStreaming: false,
          steeringMode: "all",
          followUpMode: "all",
        },
      });

      ws.close();
    },
    TEST_TIMEOUT,
  );

  it(
    "should handle get_commands command",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);

      const ws = await openBridgeWebSocket(state.controller);

      const commandId = "test-cmd-2";
      ws.send(
        JSON.stringify({
          type: "command",
          payload: { id: commandId, type: "get_commands" },
        }),
      );

      const response = (await awaitResponse(ws, commandId)) as {
        success: boolean;
        data: { commands: Array<{ name: string }> };
      };

      expect(response.success).toBe(true);
      expect(response.data.commands).toHaveLength(1);
      expect(response.data.commands[0].name).toBe("/test");

      ws.close();
    },
    TEST_TIMEOUT,
  );

  it(
    "should handle prompt command via auto-created session",
    async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "pi-web-int-prompt-"),
      );
      const sessionFile = path.join(tmpDir, "session.jsonl");
      fs.writeFileSync(
        sessionFile,
        JSON.stringify({
          type: "session",
          version: 3,
          id: "int-test-session",
          timestamp: new Date().toISOString(),
          cwd: tmpDir,
        }),
      );
      (
        state.mockContext.state.sessionManager.getSessionFile as ReturnType<
          typeof vi.fn
        >
      ).mockReturnValue(sessionFile);
      (state.mockContext.state as unknown as Record<string, unknown>).cwd =
        tmpDir;

      const promptSpy = vi.fn().mockResolvedValue(undefined);
      createAgentSessionMock.mockResolvedValue({
        session: {
          sessionFile: undefined,
          sessionId: "auto-session",
          isStreaming: false,
          bindExtensions: vi.fn().mockResolvedValue(undefined),
          subscribe: vi.fn().mockReturnValue(() => {}),
          prompt: promptSpy,
          dispose: vi.fn(),
          sessionManager: {
            getSessionFile: vi.fn(),
            getSessionId: vi.fn().mockReturnValue("auto-session"),
            getEntries: vi.fn().mockReturnValue([]),
            getBranch: vi.fn().mockReturnValue([]),
            getCwd: vi.fn().mockReturnValue(tmpDir),
          },
        },
      });

      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);

      const ws = await openBridgeWebSocket(state.controller);

      const commandId = "test-cmd-3";
      ws.send(
        JSON.stringify({
          type: "command",
          payload: { id: commandId, type: "prompt", message: "Hello from bridge" },
        }),
      );

      const response = (await awaitResponse(ws, commandId)) as Record<
        string,
        unknown
      >;

      expect(response).toMatchObject({
        type: "response",
        command: "new_session",
        success: true,
      });
      expect(response.data).toMatchObject({ cancelled: false });
      expect(
        (response.data as Record<string, unknown>).sessionPath,
      ).toBeDefined();

      expect(state.mockContext.actions.sendUserMessage).not.toHaveBeenCalled();

      ws.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
    TEST_TIMEOUT,
  );

  it(
    "should handle unknown commands with error response",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);
      state.controller.subscribe(event => state.events.push(event));

      const ws = await openBridgeWebSocket(state.controller);
      await new Promise(resolve => setTimeout(resolve, 100));

      const commandId = "test-cmd-4";
      ws.send(
        JSON.stringify({
          type: "command",
          payload: { id: commandId, type: "unknown_command_xyz" },
        }),
      );

      const response = (await awaitResponse(ws, commandId)) as {
        success: boolean;
        error?: string;
      };

      expect(response.success).toBe(false);
      expect(response.error).toContain("unknown");

      ws.close();
    },
    TEST_TIMEOUT,
  );
});