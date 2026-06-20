import { existsSync, readdirSync, statSync, watch } from "node:fs";
import { join, resolve, sep } from "node:path";
//#region src/standalone/dev-reload.ts
const DEV_BRIDGE_ENTRY_SEGMENT = `${sep}packages${sep}bridge${sep}src${sep}`;
const DEFAULT_DEBOUNCE_MS = 75;
const IGNORED_DIRECTORIES = new Set([
	".git",
	"dist",
	"node_modules"
]);
function resolveStandaloneDevWatchPath(entryFile) {
	const resolvedEntryFile = resolve(entryFile);
	const markerIndex = resolvedEntryFile.lastIndexOf(DEV_BRIDGE_ENTRY_SEGMENT);
	if (markerIndex === -1) return;
	return join(resolvedEntryFile.slice(0, markerIndex), "packages", "bridge");
}
function listBridgeWatchDirectories(rootPath) {
	const directories = [];
	const visit = (directoryPath) => {
		directories.push(directoryPath);
		for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
			if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
			visit(join(directoryPath, entry.name));
		}
	};
	visit(rootPath);
	return directories;
}
function createStandaloneDevReloadController(options) {
	const watchPath = resolveStandaloneDevWatchPath(options.entryFile);
	if (!watchPath || !existsSync(watchPath) || !statSync(watchPath).isDirectory()) return;
	const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	const logger = options.logger ?? console;
	let disposed = false;
	let requested = false;
	let debounceTimer;
	let rescanScheduled = false;
	let lastChange = { eventType: "change" };
	const watchers = /* @__PURE__ */ new Map();
	const cleanupWatchers = () => {
		for (const watcher of watchers.values()) watcher.close();
		watchers.clear();
	};
	const refreshWatchers = () => {
		if (disposed) return;
		const nextDirectories = new Set(listBridgeWatchDirectories(watchPath));
		for (const [directoryPath, watcher] of watchers) {
			if (nextDirectories.has(directoryPath)) continue;
			watcher.close();
			watchers.delete(directoryPath);
		}
		for (const directoryPath of nextDirectories) {
			if (watchers.has(directoryPath)) continue;
			const watcher = watch(directoryPath, (eventType, filename) => {
				if (disposed || requested) return;
				lastChange = {
					eventType,
					filename: typeof filename === "string" && filename.length > 0 ? filename : void 0
				};
				if (eventType === "rename" && !rescanScheduled) {
					rescanScheduled = true;
					queueMicrotask(() => {
						rescanScheduled = false;
						if (!disposed) refreshWatchers();
					});
				}
				clearTimeout(debounceTimer);
				debounceTimer = setTimeout(() => {
					if (disposed || requested) return;
					requested = true;
					const changedPath = lastChange.filename ? ` (${lastChange.filename})` : "";
					logger.log(`[pi-web] Detected bridge change${changedPath}; reloading standalone runtime...`);
					Promise.resolve(options.stop()).catch((error) => {
						logger.error("[pi-web] Failed to stop standalone bridge for hot reload:", error);
					});
				}, debounceMs);
			});
			watcher.on("error", (error) => {
				if (!disposed) logger.error("[pi-web] Standalone bridge dev watcher error:", error);
			});
			watchers.set(directoryPath, watcher);
		}
	};
	refreshWatchers();
	logger.log(`[pi-web] Watching standalone bridge sources: ${watchPath}`);
	return {
		watchPath,
		reloadRequested() {
			return requested;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			clearTimeout(debounceTimer);
			cleanupWatchers();
		}
	};
}
//#endregion
export { createStandaloneDevReloadController, resolveStandaloneDevWatchPath };
