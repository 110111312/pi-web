/**
 * Pi Extension Entry Point - Web Bridge
 *
 * Registers the `/web` command that starts the bridge server,
 * degrades the terminal to a read-only log view, and allows
 * browser clients to interact with Pi via WebSocket RPC.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_BRIDGE_CONFIG, type BridgeConfig } from "@pi-web/bridge/types";
import type { WsRpcAdapterContext } from "@pi-web/bridge/ws-rpc-adapter";
import { isBridgeExitInput } from "./exit-input.js";
import { startBridge, type BridgeController } from "./lifecycle.js";
import {
  createBridgeSessionActions,
  createBridgeSessionEvents,
  createBridgeSessionState,
} from "./pi-live-session.js";
import { createBridgeTerminalView } from "./terminal-log-view.js";

const HEADLESS_ENV = "PI_WEB_HEADLESS";
const READY_FILE_ENV = "PI_WEB_READY_FILE";
const SHUTDOWN_FILE_ENV = "PI_WEB_SHUTDOWN_FILE";
const SHUTDOWN_POLL_MS = 200;

export interface WebCommandOptions {
  headless: boolean;
  readyFile?: string;
  shutdownFile?: string;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  switch (value.trim().toLowerCase()) {
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return true;
  }
}

export function parseWebCommandOptions(
  args: string,
  env: NodeJS.ProcessEnv = process.env,
  hasUI = true,
): WebCommandOptions {
  const tokens = args
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);

  return {
    headless:
      tokens.includes("--headless") || isTruthyEnv(env[HEADLESS_ENV]) || !hasUI,
    readyFile: env[READY_FILE_ENV],
    shutdownFile: env[SHUTDOWN_FILE_ENV],
  };
}

async function writeReadyFile(
  readyFile: string,
  payload: Record<string, string>,
): Promise<void> {
  await mkdir(dirname(readyFile), { recursive: true });
  await writeFile(
    `${readyFile}`,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

async function runHeadlessWebBridge(
  config: BridgeConfig,
  adapterContext: WsRpcAdapterContext,
  options: WebCommandOptions,
  ctx: ExtensionCommandContext,
): Promise<void> {
  let resolveStopped: (() => void) | undefined;
  const stopped = new Promise<void>(resolve => {
    resolveStopped = resolve;
  });

  const bridgeController = await startBridge(
    config,
    adapterContext,
    () => resolveStopped?.(),
    {
      captureSigint: false,
    },
  );

  const bridgeUrl = bridgeController.getBridgeUrl();
  if (!bridgeUrl) {
    await bridgeController.stop();
    throw new Error("Bridge started without a reachable URL");
  }

  const wsUrl = `${bridgeUrl.replace(/^http/, "ws")}/ws`;
  console.log(`[pi-web] Bridge URL: ${bridgeUrl}`);
  console.log(`[pi-web] WebSocket: ${wsUrl}`);

  if (options.readyFile) {
    await writeReadyFile(options.readyFile, { bridgeUrl, wsUrl });
  }

  const requestStop = (): void => {
    void bridgeController.stop().catch(err => {
      console.error("[pi-web] Failed to stop bridge:", err);
    });
  };

  const onSigint = (): void => {
    requestStop();
  };
  const onSigterm = (): void => {
    requestStop();
  };
  const onAbort = (): void => {
    requestStop();
  };

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  ctx.signal?.addEventListener("abort", onAbort, { once: true });

  const shutdownPoll = options.shutdownFile
    ? setInterval(() => {
        if (existsSync(options.shutdownFile!)) {
          requestStop();
        }
      }, SHUTDOWN_POLL_MS)
    : undefined;
  shutdownPoll?.unref();

  try {
    await stopped;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    ctx.signal?.removeEventListener("abort", onAbort);
    if (shutdownPoll) {
      clearInterval(shutdownPoll);
    }
  }
}

async function webBridgeHandler(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  const adapterContext: WsRpcAdapterContext = {
    events: createBridgeSessionEvents(pi),
    state: createBridgeSessionState(ctx, pi),
    actions: createBridgeSessionActions(pi, ctx),
  };

  const thisFile = fileURLToPath(import.meta.url);
  const projectRoot = join(dirname(thisFile), "..", "..");
  const webDistDir = join(projectRoot, "web-dist");
  const staticDir = existsSync(webDistDir) ? webDistDir : undefined;
  const options = parseWebCommandOptions(args, process.env, ctx.hasUI);

  const config: BridgeConfig = {
    ...DEFAULT_BRIDGE_CONFIG,
    port: process.env.PI_BRIDGE_PORT
      ? parseInt(process.env.PI_BRIDGE_PORT, 10)
      : DEFAULT_BRIDGE_CONFIG.port,
    host: process.env.PI_BRIDGE_HOST || DEFAULT_BRIDGE_CONFIG.host,
    staticDir,
  };

  if (options.headless) {
    await runHeadlessWebBridge(config, adapterContext, options, ctx);
    return;
  }

  let bridgeController: BridgeController | undefined;
  let terminalView:
    | (ReturnType<typeof createBridgeTerminalView> & { dispose: () => void })
    | undefined;
  let finishWebMode: (() => void) | undefined;

  try {
    bridgeController = await startBridge(
      config,
      adapterContext,
      () => {
        terminalView?.requestExit();
        finishWebMode?.();
      },
      {
        // Ctrl+C is already handled by the Pi custom view + stdin bridge-exit
        // detection. Avoid registering another process-level SIGINT handler here,
        // which can leave Pi in a bad state after exiting /web.
        captureSigint: false,
      },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await ctx.ui.custom<void>((_tui, _theme, _kb, done) => {
      return {
        render() {
          return [`Error: ${errorMsg}`, "", "Press any key to exit..."];
        },
        handleInput() {
          done();
        },
        invalidate() {},
      };
    });
    return;
  }

  const stdinExitHandler = (data: Buffer | string): void => {
    const input = typeof data === "string" ? data : data.toString("utf8");
    if (isBridgeExitInput(input)) {
      finishWebMode?.();
    }
  };

  process.stdin.on("data", stdinExitHandler);

  try {
    await ctx.ui.custom<void>((tui, _theme, kb, done) => {
      let finishRequested = false;
      finishWebMode = () => {
        if (finishRequested) {
          return;
        }
        finishRequested = true;
        terminalView?.requestExit();
        done();
      };

      const view = createBridgeTerminalView(
        handler => bridgeController!.subscribe(handler),
        () => bridgeController!.getState(),
        () => bridgeController!.getClients(),
        config,
        force => tui.requestRender(force),
      );
      terminalView = view;

      return {
        render() {
          return view.render();
        },
        handleInput(input: string) {
          view.handleInput(input);
          if (
            isBridgeExitInput(input, {
              matches: (candidate, action) => {
                if (action !== "selectCancel" && action !== "copy") {
                  return false;
                }
                return kb.matches(
                  candidate,
                  action as unknown as Parameters<typeof kb.matches>[1],
                );
              },
            }) ||
            view.shouldExit()
          ) {
            finishWebMode?.();
          }
        },
        shouldExit() {
          return view.shouldExit();
        },
        invalidate() {
          tui.requestRender();
        },
        dispose() {
          view.dispose();
          // Force a full redraw so the tall terminal view cannot leave stale lines behind.
          queueMicrotask(() => tui.requestRender(true));
        },
      };
    });
  } finally {
    finishWebMode = undefined;
    process.stdin.off("data", stdinExitHandler);
    terminalView?.dispose();
    if (bridgeController && bridgeController.getState().status !== "stopped") {
      await bridgeController.stop();
    }
  }
}

export default function registerWebBridge(
  pi: ExtensionAPI,
  _state: unknown,
): void {
  pi.registerCommand("web", {
    description: "Start web bridge server for browser-based interaction",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await webBridgeHandler(args, ctx, pi);
    },
  });
}

export { webBridgeHandler };
