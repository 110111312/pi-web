import { dirname, join, resolve } from "node:path";
import { createJiti } from "jiti/static";
import { DEFAULT_BRIDGE_CONFIG as STATIC_DEFAULT_BRIDGE_CONFIG } from "../types.js";
import type { BridgeConfig } from "../types.js";
import { resolveStandaloneDevWatchPath } from "./dev-reload.js";
import {
  startStandaloneBridge as staticStartStandaloneBridge,
  type StandaloneBridgeController,
  type StartStandaloneBridgeOptions,
} from "./server.js";

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
});

export interface StandaloneRuntime {
  DEFAULT_BRIDGE_CONFIG: BridgeConfig;
  startStandaloneBridge: (
    config: BridgeConfig,
    options?: StartStandaloneBridgeOptions,
  ) => Promise<StandaloneBridgeController>;
}

const staticRuntime: StandaloneRuntime = {
  DEFAULT_BRIDGE_CONFIG: STATIC_DEFAULT_BRIDGE_CONFIG,
  startStandaloneBridge: staticStartStandaloneBridge,
};

export async function loadStandaloneRuntime(
  entryFile: string,
): Promise<StandaloneRuntime> {
  if (!resolveStandaloneDevWatchPath(entryFile)) {
    return staticRuntime;
  }

  const runtimeEntryPath = join(
    dirname(resolve(entryFile)),
    "runtime-entry.ts",
  );

  return jiti.import(runtimeEntryPath, { default: true });
}
