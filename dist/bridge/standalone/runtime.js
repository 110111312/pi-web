import { DEFAULT_BRIDGE_CONFIG } from "../types.js";
import { resolveStandaloneDevWatchPath } from "./dev-reload.js";
import { startStandaloneBridge } from "./server.js";
import { dirname, join, resolve } from "node:path";
//#region src/standalone/runtime.ts
const staticRuntime = {
	DEFAULT_BRIDGE_CONFIG,
	startStandaloneBridge
};
async function loadStandaloneRuntime(entryFile) {
	if (!resolveStandaloneDevWatchPath(entryFile)) return staticRuntime;
	const runtimeEntryPath = join(dirname(resolve(entryFile)), "runtime-entry.ts");
	const { createJiti } = await import(["jiti", "static"].join("/"));
	return createJiti(import.meta.url, { moduleCache: false }).import(runtimeEntryPath, { default: true });
}
//#endregion
export { loadStandaloneRuntime };
