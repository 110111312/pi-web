/**
 * Bridge lifecycle management.
 *
 * Handles:
 * - startBridge() with port range fallback
 * - SIGINT handler registration and cleanup
 * - stop() that closes everything and invokes done() callback
 */

import { BridgeEventBus } from "./bridge-event-bus.js";
import { BridgeServer } from "./server.js";
import type {
  BridgeConfig,
  BridgeEvent,
  BridgeState,
  WsClient,
} from "./types.js";
import type { WsRpcAdapterContext } from "./ws-rpc-adapter.js";

/**
 * Callback invoked when the bridge shuts down
 */
export type BridgeDoneCallback = () => void;

/**
 * Bridge controller managing the full lifecycle
 */
export interface BridgeController {
  /** Get current bridge state */
  getState(): BridgeState;
  /** Get the bridge URL for display */
  getBridgeUrl(): string | undefined;
  /** Get list of connected clients */
  getClients(): WsClient[];
  /** Stop the bridge gracefully */
  stop(): Promise<void>;
  /** Subscribe to bridge events */
  subscribe(handler: (event: BridgeEvent) => void): () => void;
}

/**
 * Start the bridge with lifecycle management
 *
 * @param config Bridge configuration
 * @param context Pi extension context for command dispatch
 * @param done Callback invoked when bridge shuts down
 * @returns Bridge controller
 */
export interface StartBridgeOptions {
  /**
   * Register a process-level SIGINT handler.
   * Disable this when the caller already handles Ctrl+C inside a custom UI.
   */
  captureSigint?: boolean;
}

export async function startBridge(
  config: BridgeConfig,
  context: WsRpcAdapterContext,
  done: BridgeDoneCallback,
  options: StartBridgeOptions = {},
): Promise<BridgeController> {
  // Create event bus for internal communication
  const eventBus = new BridgeEventBus(config);

  // Event handlers for terminal log view
  const eventHandlers: Array<(event: BridgeEvent) => void> = [];

  // Emit events to all handlers
  const emitEvent = (event: BridgeEvent): void => {
    // Emit to internal handlers (terminal log view)
    for (const handler of eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error("Bridge lifecycle: event handler error:", err);
      }
    }
    // Also emit to event bus for any subscribers
    eventBus.emit(event);
  };

  // Create server
  const server = new BridgeServer(config, context, eventBus, emitEvent);

  // State tracking
  let state: BridgeState = { status: "starting", port: config.port };

  // Start the server
  try {
    const address = await server.start();
    state = { status: "running", host: address.host, port: address.port };
  } catch (err) {
    state = { status: "stopped" };
    throw err;
  }

  // SIGINT handler
  let sigintHandler: (() => void) | undefined;

  // Track if we're already shutting down
  let isShuttingDown = false;

  /**
   * Graceful shutdown
   */
  const shutdown = async (): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    state = { status: "stopping" };

    // Emit SIGINT event
    emitEvent({ type: "sigint_received" });

    // Remove SIGINT handler
    if (sigintHandler) {
      process.off("SIGINT", sigintHandler);
    }

    try {
      // Stop server
      await server.stop();

      // Dispose event bus
      eventBus.dispose();

      state = { status: "stopped" };

      // Emit shutdown complete
      emitEvent({ type: "shutdown_complete" });
    } catch (err) {
      console.error("Bridge shutdown error:", err);
      state = { status: "stopped" };
      throw err;
    } finally {
      // Notify that we're done
      done();
    }
  };

  // Register SIGINT handler
  if (options.captureSigint !== false) {
    sigintHandler = () => {
      console.log("\n[Bridge] SIGINT received, shutting down...");
      void shutdown();
    };
    process.on("SIGINT", sigintHandler);
  }

  // Return controller
  return {
    getState() {
      return state;
    },

    getBridgeUrl() {
      if (state.status === "running") {
        return `http://${state.host}:${state.port}`;
      }
      return undefined;
    },

    getClients() {
      return server.getClients();
    },

    stop() {
      return shutdown();
    },

    subscribe(handler) {
      eventHandlers.push(handler);
      return () => {
        const idx = eventHandlers.indexOf(handler);
        if (idx !== -1) {
          eventHandlers.splice(idx, 1);
        }
      };
    },
  };
}
