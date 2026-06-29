/**
 * Integration tests for malformed and unknown message handling.
 */

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BRIDGE_CONFIG } from "@pi-web/bridge/types";
import { startBridge } from "../lifecycle.js";
import {
  TEST_TIMEOUT,
  installBridgeTestLifecycle,
  openBridgeWebSocket,
  type BridgeTestState,
} from "./integration.helpers.js";

const state: BridgeTestState = {
  mockContext: undefined as never,
  controller: undefined,
  events: [],
};
installBridgeTestLifecycle(state);

describe("Bridge Integration: Error Handling", () => {
  it(
    "should handle malformed JSON messages",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);

      const ws = await openBridgeWebSocket(state.controller);

      const responsePromise = new Promise<unknown>((resolve, reject) => {
        ws.on("message", data => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "response") {
              resolve(msg.payload);
            }
          } catch {
            /* ignore parse errors */
          }
        });
        setTimeout(() => reject(new Error("Response timeout")), 5000);
      });

      ws.send("this is not valid json{");

      const response = (await responsePromise) as {
        success: boolean;
        error?: string;
      };

      expect(response.success).toBe(false);
      expect(response.error).toContain("parse");

      ws.close();
    },
    TEST_TIMEOUT,
  );

  it(
    "should handle unknown message types",
    async () => {
      const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
      state.controller = await startBridge(config, state.mockContext, vi.fn);

      const ws = await openBridgeWebSocket(state.controller);

      const responsePromise = new Promise<unknown>((resolve, reject) => {
        ws.on("message", data => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "response") {
              resolve(msg.payload);
            }
          } catch {
            /* ignore parse errors */
          }
        });
        setTimeout(() => reject(new Error("Response timeout")), 5000);
      });

      ws.send(
        JSON.stringify({
          type: "unknown_type",
          payload: {},
        }),
      );

      const response = (await responsePromise) as {
        success: boolean;
        error?: string;
      };

      expect(response.success).toBe(false);
      expect(response.error).toContain("Unknown message type");

      ws.close();
    },
    TEST_TIMEOUT,
  );
});