import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BridgeEventBus } from "../bridge-event-bus.js";
import { BridgeServer, type WsConnectionHandler } from "../server.js";
import { DEFAULT_BRIDGE_CONFIG, type BridgeEvent } from "../types.js";
import {
  collectEvents,
  createMockHandlerFactory,
  waitForAsyncWork,
} from "./server.test-helpers.js";

describe("BridgeServer WS connections", () => {
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

  it("accepts WS connect without a token", async () => {
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
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await server.stop();
  });

  it("accepts WS connect when a legacy token query param is present", async () => {
    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );
    const address = await server.start();

    const ws = new WebSocket(
      `ws://localhost:${address.port}/ws?token=legacy`,
    );
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await server.stop();
  });
});

describe("BridgeServer client tracking", () => {
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

  it("reflects WebSocket clients as they connect and disconnect", async () => {
    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );
    const address = await server.start();

    expect(server.getClientCount()).toBe(0);
    expect(server.getClients()).toEqual([]);

    const ws = new WebSocket(`ws://localhost:${address.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await waitForAsyncWork();

    const clients = server.getClients();
    expect(server.getClientCount()).toBe(1);
    expect(clients).toHaveLength(1);
    expect(clients[0].id).toBeTruthy();
    expect(clients[0].connectedAt).toBeTruthy();

    ws.close();
    await waitForAsyncWork();

    expect(server.getClientCount()).toBe(0);
    expect(server.getClients()).toEqual([]);
    expect(events.map(event => event.type)).toContain("client_connect");
    expect(events.map(event => event.type)).toContain("client_disconnect");

    await server.stop();
  });

  it("emits client_connect after the client is registered", async () => {
    let server: BridgeServer;
    let clientCountAtConnect = -1;
    let connectedClientId: string | undefined;

    const localHandlers: WsConnectionHandler[] = [];
    const localFactory = createMockHandlerFactory(localHandlers);
    server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      localFactory,
      eventBus,
      event => {
        events.push(event);
        if (event.type === "client_connect") {
          clientCountAtConnect = server.getClientCount();
          connectedClientId = server.getClients()[0]?.id;
        }
      },
    );
    const address = await server.start();

    const ws = new WebSocket(`ws://localhost:${address.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await waitForAsyncWork();

    const connectEvent = events.find(
      event => event.type === "client_connect",
    );
    expect(connectEvent).toBeTruthy();
    expect(clientCountAtConnect).toBe(1);
    expect(connectedClientId).toBe(
      (connectEvent as Extract<BridgeEvent, { type: "client_connect" }>)
        .client.id,
    );

    ws.close();
    await waitForAsyncWork();
    await server.stop();
  });
});