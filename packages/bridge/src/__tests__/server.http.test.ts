import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeEventBus } from "../bridge-event-bus.js";
import { BridgeServer, type WsConnectionHandler } from "../server.js";
import { DEFAULT_BRIDGE_CONFIG, type BridgeEvent } from "../types.js";
import {
  collectEvents,
  createMockHandlerFactory,
  requestText,
} from "./server.test-helpers.js";

describe("BridgeServer HTTP access", () => {
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

  it("serves HTTP GET without requiring a token", async () => {
    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );
    const address = await server.start();

    const response = await requestText(`http://localhost:${address.port}/`);
    expect(response.status).toBe(200);
    expect(response.body).toContain("Pi Web Bridge");
    expect(response.headers["set-cookie"]).toBeUndefined();

    await server.stop();
  });

  it("ignores legacy token query params and cookies", async () => {
    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );
    const address = await server.start();

    const response = await requestText(
      `http://localhost:${address.port}/?token=legacy`,
      { cookies: { pi_token: "wrong-token" } },
    );
    expect(response.status).toBe(200);
    expect(response.body).toContain("Pi Web Bridge");
    expect(response.headers["set-cookie"]).toBeUndefined();

    await server.stop();
  });
});

describe("BridgeServer HTTP static file serving", () => {
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

  it("serves placeholder HTML at the root when no staticDir is configured", async () => {
    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );
    const address = await server.start();

    const response = await requestText(
      `http://localhost:${address.port}/?token=legacy`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toContain("Pi Web Bridge");
    expect(response.body).toContain(`http://localhost:${address.port}`);

    await server.stop();
  });

  it("returns 404 for unknown files when no staticDir is configured", async () => {
    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );
    const address = await server.start();

    const response = await requestText(
      `http://localhost:${address.port}/some-file.js`,
    );
    expect(response.status).toBe(404);
    expect(response.body).toContain("Not Found");

    await server.stop();
  });

  it("rejects non-GET methods", async () => {
    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0 },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );
    const address = await server.start();

    const response = await requestText(
      `http://localhost:${address.port}/?token=legacy`,
      {
        method: "POST",
      },
    );
    expect(response.status).toBe(405);
    expect(response.body).toContain("Method Not Allowed");

    await server.stop();
  });
});