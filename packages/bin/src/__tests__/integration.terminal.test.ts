/**
 * Integration tests for the terminal log view (bridge status display).
 */

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BRIDGE_CONFIG } from "@pi-web/bridge/types";
import { startBridge } from "../lifecycle.js";
import { createBridgeTerminalView } from "../terminal-log-view.js";
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

describe("Bridge Integration: Terminal Log View", () => {
  it(
    "should create terminal view with bridge events",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);

      const terminalView = createBridgeTerminalView(
        handler => state.controller!.subscribe(handler),
        () => state.controller!.getState(),
        () => state.controller!.getClients(),
        config,
      );

      const renderOutput = terminalView.render();
      expect(renderOutput.length).toBeGreaterThan(0);
      expect(renderOutput.some(line => line.includes("Pi Web Bridge"))).toBe(
        true,
      );
      expect(renderOutput.some(line => line.includes("Bridge:"))).toBe(true);

      terminalView.dispose();
    },
    TEST_TIMEOUT,
  );

  it(
    "should update view when clients connect",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);

      const terminalView = createBridgeTerminalView(
        handler => state.controller!.subscribe(handler),
        () => state.controller!.getState(),
        () => state.controller!.getClients(),
        config,
      );
      const initialRender = terminalView.render();
      expect(initialRender.some(line => line.includes("Clients: 0"))).toBe(
        true,
      );

      const ws = await openBridgeWebSocket(state.controller);
      await new Promise(resolve => setTimeout(resolve, 100));

      const updatedRender = terminalView.render();
      expect(updatedRender.some(line => line.includes("Clients: 1"))).toBe(
        true,
      );

      await closeBridgeWebSocket(ws);
      terminalView.dispose();
    },
    TEST_TIMEOUT,
  );
});