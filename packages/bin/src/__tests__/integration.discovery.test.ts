/**
 * Integration tests for discovery commands (list_sessions, list_tree_entries).
 */

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BRIDGE_CONFIG } from "@pi-web/bridge/types";
import { startBridge } from "../lifecycle.js";
import {
  TEST_TIMEOUT,
  installBridgeTestLifecycle,
  openBridgeWebSocket,
  awaitResponse,
  type BridgeTestState,
} from "./integration.helpers.js";

const state: BridgeTestState = {
  mockContext: undefined as never,
  controller: undefined,
  events: [],
};
installBridgeTestLifecycle(state);

describe("Bridge Integration: Discovery Commands", () => {
  it(
    "should handle list_sessions command via WebSocket",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);

      const ws = await openBridgeWebSocket(state.controller);

      const commandId = "list-sessions-1";
      ws.send(
        JSON.stringify({
          type: "command",
          payload: {
            id: commandId,
            type: "list_sessions",
            workspacePath: "/tmp",
          },
        }),
      );

      const response = (await awaitResponse(ws, commandId)) as {
        command: string;
        success: boolean;
        data: { sessions: Array<{ id: string; name: string; path: string }> };
      };

      expect(response.command).toBe("list_sessions");
      expect(response.success).toBe(true);
      expect(Array.isArray(response.data.sessions)).toBe(true);

      ws.close();
    },
    TEST_TIMEOUT,
  );

  it(
    "should handle list_tree_entries command via WebSocket",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);

      const ws = await openBridgeWebSocket(state.controller);

      const commandId = "list-tree-1";
      ws.send(
        JSON.stringify({
          type: "command",
          payload: { id: commandId, type: "list_tree_entries" },
        }),
      );

      const response = (await awaitResponse(ws, commandId)) as {
        command: string;
        success: boolean;
        data: { entries: Array<{ id: string; label: string; type: string }> };
      };

      expect(response.command).toBe("list_tree_entries");
      expect(response.success).toBe(true);
      expect(response.data.entries).toHaveLength(2);

      ws.close();
    },
    TEST_TIMEOUT,
  );
});