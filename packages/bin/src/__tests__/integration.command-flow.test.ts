/**
 * Integration tests for full multi-command request/response flow.
 */

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BRIDGE_CONFIG } from "@pi-web/bridge/types";
import { startBridge } from "../lifecycle.js";
import {
  TEST_TIMEOUT,
  installBridgeTestLifecycle,
  openBridgeWebSocket,
  sendRpcCommand,
  type BridgeTestState,
} from "./integration.helpers.js";

const state: BridgeTestState = {
  mockContext: undefined as never,
  controller: undefined,
  events: [],
};
installBridgeTestLifecycle(state);

describe("Bridge Integration: Command Flow", () => {
  it(
    "should handle complete request-response cycle with multiple commands",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);

      const ws = await openBridgeWebSocket(state.controller);

      const results = await Promise.all([
        sendRpcCommand(ws, { type: "get_state" }),
        sendRpcCommand(ws, { type: "get_commands" }),
      ]);

      for (const result of results) {
        expect((result as { success: boolean }).success).toBe(true);
      }

      const stateResult = results[0] as {
        success: boolean;
        data: { sessionId: string };
      };
      expect(stateResult.data.sessionId).toBe("test-session-123");

      const commandsResult = results[1] as {
        success: boolean;
        data: { commands: Array<{ name: string }> };
      };
      expect(commandsResult.data.commands).toHaveLength(1);

      ws.close();
    },
    TEST_TIMEOUT,
  );
});