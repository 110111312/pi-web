import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeEventBus } from "../bridge-event-bus.js";
import { BridgeServer, type WsConnectionHandler } from "../server.js";
import { DEFAULT_BRIDGE_CONFIG, type BridgeEvent } from "../types.js";
import {
  collectEvents,
  createMockHandlerFactory,
  requestText,
} from "./server.test-helpers.js";

describe("BridgeServer staticDir serving", () => {
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

  it("serves files from staticDir instead of placeholder", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "bridge-static-test-"));
    writeFileSync(join(tmpDir, "index.html"), "<h1>Real Bundle</h1>");
    writeFileSync(join(tmpDir, "app.js"), 'console.log("app");');

    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0, staticDir: tmpDir },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );
    const address = await server.start();

    try {
      const indexResponse = await requestText(
        `http://localhost:${address.port}/?token=legacy`,
      );
      expect(indexResponse.status).toBe(200);
      expect(indexResponse.body).toContain("<h1>Real Bundle</h1>");
      expect(indexResponse.body).not.toContain("Pi Web Bridge");

      const jsResponse = await requestText(
        `http://localhost:${address.port}/app.js`,
      );
      expect(jsResponse.status).toBe(200);
      expect(jsResponse.body).toContain('console.log("app");');

      const spaResponse = await requestText(
        `http://localhost:${address.port}/some-route`,
      );
      expect(spaResponse.status).toBe(200);
      expect(spaResponse.body).toContain("<h1>Real Bundle</h1>");
    } finally {
      await server.stop();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("injects runtime config into served html", async () => {
    const previousDebugEnv = process.env.PI_WEB_DEBUG;
    process.env.PI_WEB_DEBUG = "1";

    const tmpDir = mkdtempSync(join(tmpdir(), "bridge-runtime-config-test-"));
    writeFileSync(
      join(tmpDir, "index.html"),
      "<html><head></head><body>Real Bundle</body></html>",
    );

    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0, staticDir: tmpDir },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );
    const address = await server.start();

    try {
      const response = await requestText(`http://localhost:${address.port}/`);
      expect(response.status).toBe(200);
      expect(response.body).toContain(
        'window.__PI_WEB_CONFIG__={"debugModeAvailable":true}',
      );
    } finally {
      await server.stop();
      rmSync(tmpDir, { recursive: true, force: true });
      if (previousDebugEnv === undefined) {
        delete process.env.PI_WEB_DEBUG;
      } else {
        process.env.PI_WEB_DEBUG = previousDebugEnv;
      }
    }
  });

  it("rejects directory traversal attempts against staticDir", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "bridge-traversal-test-"));
    const secretDir = join(tmpDir, "secret");
    mkdirSync(secretDir);
    writeFileSync(join(secretDir, "key.txt"), "secret-key");
    writeFileSync(join(tmpDir, "index.html"), "<h1>Safe</h1>");

    const server = new BridgeServer(
      { ...DEFAULT_BRIDGE_CONFIG, port: 0, staticDir: tmpDir },
      handlerFactory,
      eventBus,
      collectEvents(events),
    );
    const address = await server.start();

    try {
      const traversalResponse = await requestText(
        `http://localhost:${address.port}/../../../etc/passwd`,
      );
      expect(traversalResponse.status).toBe(200);
      expect(traversalResponse.body).toContain("<h1>Safe</h1>");
      expect(traversalResponse.body).not.toContain("secret-key");

      const insideResponse = await requestText(
        `http://localhost:${address.port}/secret/key.txt`,
      );
      expect(insideResponse.status).toBe(200);
      expect(insideResponse.body).toContain("secret-key");
    } finally {
      await server.stop();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});