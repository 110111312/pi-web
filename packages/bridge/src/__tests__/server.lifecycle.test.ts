import * as http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeEventBus } from "../bridge-event-bus.js";
import { BridgeServer, type WsConnectionHandler } from "../server.js";
import { DEFAULT_BRIDGE_CONFIG, type BridgeEvent } from "../types.js";
import { collectEvents, createMockHandlerFactory } from "./server.test-helpers.js";

describe("BridgeServer lifecycle", () => {
  let eventBus: BridgeEventBus;
  let createdHandlers: WsConnectionHandler[];
  let handlerFactory: ReturnType<typeof createMockHandlerFactory>;
  let events: BridgeEvent[];

  beforeEach(() => {
    eventBus = new BridgeEventBus(DEFAULT_BRIDGE_CONFIG);
    createdHandlers = [];
    handlerFactory = createMockHandlerFactory(createdHandlers);
    events = [];
  });

  afterEach(() => {
    eventBus.dispose();
  });

  it("starts on an available port and emits server_start", async () => {
    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );

    const address = await server.start();

    expect(server.getIsRunning()).toBe(true);
    expect(address.port).toBeGreaterThan(0);
    expect(events).toContainEqual({
      type: "server_start",
      host: "0.0.0.0",
      port: address.port,
    });

    await server.stop();
  });

  it("rejects a second start while already running", async () => {
    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );

    await server.start();
    await expect(server.start()).rejects.toThrow("Server is already running");

    await server.stop();
  });

  it("stops gracefully and clears its address", async () => {
    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );

    await server.start();
    await server.stop();

    expect(server.getIsRunning()).toBe(false);
    expect(server.getAddress()).toBeUndefined();
    expect(events).toContainEqual({ type: "server_stop" });
  });

  it("stops even when a browser websocket is still connected", async () => {
    const { WebSocket } = await import("ws");
    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );

    const address = await server.start();
    const ws = new WebSocket(`ws://localhost:${address.port}/ws`);

    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    const closedPromise = new Promise<void>(resolve => {
      ws.once("close", () => resolve());
    });

    await Promise.race([
      server.stop(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("server stop timed out")), 1500);
      }),
    ]);
    await closedPromise;

    expect(server.getIsRunning()).toBe(false);
    expect(server.getAddress()).toBeUndefined();
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    expect(events).toContainEqual({ type: "server_stop" });
  });

  it("can restart after a full stop", async () => {
    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );

    const first = await server.start();
    await server.stop();
    const second = await server.start();

    expect(first.port).toBeGreaterThan(0);
    expect(second.port).toBeGreaterThan(0);
    expect(server.getIsRunning()).toBe(true);

    await server.stop();
  });
});

describe("BridgeServer port fallback", () => {
  let eventBus: BridgeEventBus;
  let createdHandlers: WsConnectionHandler[];
  let handlerFactory: ReturnType<typeof createMockHandlerFactory>;
  let events: BridgeEvent[];

  beforeEach(() => {
    eventBus = new BridgeEventBus(DEFAULT_BRIDGE_CONFIG);
    createdHandlers = [];
    handlerFactory = createMockHandlerFactory(createdHandlers);
    events = [];
  });

  afterEach(() => {
    eventBus.dispose();
  });

  it("falls back within the configured port range when the preferred port is taken", async () => {
    const occupiedServer = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("occupied");
    });
    await new Promise<void>(resolve =>
      occupiedServer.listen(0, "127.0.0.1", () => resolve()),
    );

    const address = occupiedServer.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to get occupied port");
    }

    const preferredPort = address.port;
    const server = new BridgeServer(
      {
        ...DEFAULT_BRIDGE_CONFIG,
        host: "127.0.0.1",
        port: preferredPort,
        portMax: preferredPort + 3,
      },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );

    try {
      const bridgeAddress = await server.start();
      expect(bridgeAddress.port).not.toBe(preferredPort);
      expect(bridgeAddress.port).toBeGreaterThan(preferredPort);
      expect(bridgeAddress.port).toBeLessThanOrEqual(preferredPort + 3);
    } finally {
      await server.stop();
      await new Promise<void>((resolve, reject) => {
        occupiedServer.close(error => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("uses an OS-assigned port when configured with port 0", async () => {
    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );

    const address = await server.start();
    expect(address.port).toBeGreaterThan(0);
    expect(server.getAddress()).toEqual({
      host: "0.0.0.0",
      port: address.port,
    });

    await server.stop();
  });
});