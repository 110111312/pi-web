/**
 * Integration tests covering bridge lifecycle events:
 * server start/stop, SIGINT handling, and end-to-end event verification.
 */

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BRIDGE_CONFIG, type BridgeEvent } from "@pi-web/bridge/types";
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

describe("Bridge Integration: Lifecycle", () => {
  describe("Server Lifecycle", () => {
    it(
      "should start server and bind to a port",
      async () => {
        const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
        state.controller = await startBridge(config, state.mockContext, vi.fn);

        const bridgeState = state.controller.getState();
        expect(bridgeState.status).toBe("running");
        if (bridgeState.status === "running") {
          expect(bridgeState.port).toBeGreaterThan(0);
          expect(bridgeState.host).toBe(config.host);
        }
      },
      TEST_TIMEOUT,
    );

    it(
      "should publish shutdown lifecycle events to subscribers",
      async () => {
        const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
        state.controller = await startBridge(config, state.mockContext, vi.fn);

        state.controller.subscribe(event => state.events.push(event));
        await state.controller.stop();

        expect(state.events.some(e => e.type === "server_stop")).toBe(true);
        expect(state.events.some(e => e.type === "shutdown_complete")).toBe(
          true,
        );
      },
      TEST_TIMEOUT,
    );
  });

  describe("SIGINT Handling", () => {
    it(
      "should emit sigint_received and shutdown_complete on SIGINT",
      async () => {
        const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
        state.controller = await startBridge(config, state.mockContext, vi.fn);

        state.controller.subscribe(event => state.events.push(event));

        process.emit("SIGINT");

        await new Promise(resolve => setTimeout(resolve, 200));

        expect(state.events.some(e => e.type === "sigint_received")).toBe(true);
        expect(state.events.some(e => e.type === "shutdown_complete")).toBe(
          true,
        );

        expect(state.controller.getState().status).toBe("stopped");
      },
      TEST_TIMEOUT,
    );
  });

  describe("Lifecycle Events Verification", () => {
    it(
      "should emit all required lifecycle events",
      async () => {
        const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
        const allEvents: BridgeEvent[] = [];

        state.controller = await startBridge(config, state.mockContext, vi.fn);
        state.controller.subscribe(event => allEvents.push(event));

        const ws = await openBridgeWebSocket(state.controller);

        await new Promise(resolve => setTimeout(resolve, 100));

        ws.send(
          JSON.stringify({
            type: "command",
            payload: { type: "get_state" },
          }),
        );
        await new Promise(resolve => setTimeout(resolve, 100));

        await closeBridgeWebSocket(ws);
        await state.controller.stop();

        const eventTypes = allEvents.map(e => e.type);

        expect(eventTypes).toContain("server_stop");
        expect(eventTypes).toContain("client_connect");
        expect(eventTypes).toContain("client_disconnect");
        expect(eventTypes).toContain("command_received");
        expect(eventTypes).toContain("shutdown_complete");
      },
      TEST_TIMEOUT,
    );
  });
});