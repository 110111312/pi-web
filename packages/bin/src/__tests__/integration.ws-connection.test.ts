/**
 * Integration tests for WebSocket client connections and connection events.
 */

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BRIDGE_CONFIG } from "@pi-web/bridge/types";
import { startBridge } from "../lifecycle.js";
import {
  TEST_TIMEOUT,
  installBridgeTestLifecycle,
  openBridgeWebSocket,
  closeBridgeWebSocket,
  type BridgeTestState,
} from "./integration.helpers.js";

const state: BridgeTestState = {
  mockContext: undefined as never,
  controller: undefined,
  events: [],
};
installBridgeTestLifecycle(state);

describe("Bridge Integration: WebSocket Connection", () => {
  it(
    "should accept WebSocket connections",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);

      const ws = await openBridgeWebSocket(state.controller);
      expect(ws.readyState).toBe(ws.OPEN);

      ws.close();
      await new Promise(resolve => setTimeout(resolve, 100));
    },
    TEST_TIMEOUT,
  );

  it(
    "should emit client_connect and client_disconnect events",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);
      state.controller.subscribe(event => state.events.push(event));

      const ws = await openBridgeWebSocket(state.controller);
      await new Promise(resolve => setTimeout(resolve, 100));

      await closeBridgeWebSocket(ws);

      expect(state.events.some(e => e.type === "client_connect")).toBe(true);
      expect(state.events.some(e => e.type === "client_disconnect")).toBe(
        true,
      );
    },
    TEST_TIMEOUT,
  );
});