/**
 * Integration tests for event broadcast delivery to connected WS clients.
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

describe("Bridge Integration: Event Broadcast", () => {
  it(
    "should deliver broadcast events to connected WS clients",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);

      const ws = await openBridgeWebSocket(state.controller);
      await new Promise(resolve => setTimeout(resolve, 100));

      const receivedEvents: unknown[] = [];
      ws.on("message", data => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "event") {
            receivedEvents.push(msg.payload);
          }
        } catch {
          /* ignore parse errors */
        }
      });

      const subscribeCalls = (
        state.mockContext.events.subscribe as ReturnType<typeof vi.fn>
      ).mock.calls;
      const eventHandler = subscribeCalls[subscribeCalls.length - 1]?.[0] as
        | ((event: object) => void)
        | undefined;

      expect(eventHandler).toBeDefined();

      eventHandler?.({ type: "agent_start", sessionId: "test-session" });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
      expect(receivedEvents[0]).toEqual({
        type: "agent_start",
        sessionPath: "/test/session.json",
      });

      ws.close();
    },
    TEST_TIMEOUT,
  );

  it(
    "should stop delivering events after WS client disconnects",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);

      const ws = await openBridgeWebSocket(state.controller);
      await new Promise(resolve => setTimeout(resolve, 100));

      await closeBridgeWebSocket(ws);

      expect(state.controller!.getClients()).toHaveLength(0);

      const subscribeCalls = (
        state.mockContext.events.subscribe as ReturnType<typeof vi.fn>
      ).mock.calls;
      const eventHandler = subscribeCalls[subscribeCalls.length - 1]?.[0] as
        | ((event: object) => void)
        | undefined;
      expect(eventHandler).toBeDefined();

      expect(() => {
        eventHandler?.({ type: "agent_start" });
      }).not.toThrow();
    },
    TEST_TIMEOUT,
  );
});