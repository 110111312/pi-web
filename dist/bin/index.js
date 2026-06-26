import * as fs from "node:fs";
import { existsSync, readdirSync, statSync, watch } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager, createAgentSessionFromServices, createAgentSessionServices, createBashToolDefinition, createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import * as http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
//#region ../bridge/src/workspace-environment.ts
const PYTHON_VENV_ACTIVATE_CANDIDATES = [
	".venv/bin/activate",
	"venv/bin/activate",
	"env/bin/activate",
	".venv/Scripts/activate",
	"venv/Scripts/activate",
	"env/Scripts/activate"
];
function fileExists(filePath) {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}
function shellQuote(value) {
	return "'" + value.replace(/'/g, "'\"'\"'") + "'";
}
function readTextFile(filePath) {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch {
		return null;
	}
}
function findPythonVenvActivateScript(cwd) {
	for (const candidate of PYTHON_VENV_ACTIVATE_CANDIDATES) if (fileExists(path.join(cwd, candidate))) return candidate;
	return null;
}
function buildDirenvEnvironment(cwd) {
	if (!fileExists(path.join(cwd, ".envrc"))) return null;
	return {
		type: "direnv",
		label: "direnv",
		detail: ".envrc"
	};
}
function normalizePythonEnvLabel(value) {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	return trimmed.replace(/^['"]|['"]$/g, "").trim() || null;
}
function readPythonVenvPrompt(cwd, activateScript) {
	const activateScriptPath = path.join(cwd, activateScript);
	const venvRoot = path.dirname(path.dirname(activateScriptPath));
	const pyvenvCfg = readTextFile(path.join(venvRoot, "pyvenv.cfg"));
	if (pyvenvCfg) {
		const prompt = normalizePythonEnvLabel(pyvenvCfg.match(/^prompt\s*=\s*(.+)$/m)?.[1]);
		if (prompt) return prompt;
	}
	const activateContents = readTextFile(activateScriptPath);
	if (!activateContents) return null;
	return normalizePythonEnvLabel(activateContents.match(/^VIRTUAL_ENV_PROMPT=(.+)$/m)?.[1]);
}
function buildPythonVenvEnvironment(cwd) {
	const activateScript = findPythonVenvActivateScript(cwd);
	if (!activateScript) return null;
	const rootDir = activateScript.split(/[\\/]/, 1)[0] || "venv";
	const configuredPrompt = readPythonVenvPrompt(cwd, activateScript);
	const fallbackWorkspaceName = path.basename(cwd);
	return {
		type: "python-venv",
		label: configuredPrompt && ![
			".venv",
			"venv",
			"env"
		].includes(configuredPrompt) ? configuredPrompt : [
			".venv",
			"venv",
			"env"
		].includes(rootDir) && fallbackWorkspaceName ? fallbackWorkspaceName : configuredPrompt || rootDir,
		detail: activateScript
	};
}
function detectWorkspaceEnvironments(cwd) {
	const normalizedCwd = cwd?.trim();
	if (!normalizedCwd) return;
	const environments = [buildDirenvEnvironment(normalizedCwd), buildPythonVenvEnvironment(normalizedCwd)].filter((environment) => Boolean(environment));
	return environments.length > 0 ? environments : void 0;
}
function buildWorkspaceActivationPrefix(cwd) {
	const normalizedCwd = cwd.trim();
	if (!normalizedCwd) return;
	const activationSteps = [];
	const environments = detectWorkspaceEnvironments(normalizedCwd) ?? [];
	for (const environment of environments) {
		if (environment.type === "direnv") {
			activationSteps.push([
				"if command -v direnv >/dev/null 2>&1; then",
				"  eval \"$(direnv export bash 2>/dev/null)\" || true",
				"fi"
			].join("\n"));
			continue;
		}
		if (environment.type === "python-venv" && environment.detail) {
			const quotedScriptPath = shellQuote(environment.detail);
			activationSteps.push([
				"if [ -z \"${VIRTUAL_ENV:-}\" ] && [ -f " + quotedScriptPath + " ]; then",
				"  . " + quotedScriptPath,
				"fi"
			].join("\n"));
		}
	}
	return activationSteps.length > 0 ? activationSteps.join("\n") : void 0;
}
//#endregion
//#region ../bridge/src/detached-session.ts
function buildDetachedShellCommandPrefix(cwd, basePrefix) {
	const prefixes = [buildWorkspaceActivationPrefix(cwd), basePrefix?.trim()].filter((value) => Boolean(value));
	return prefixes.length > 0 ? prefixes.join("\n") : void 0;
}
async function createDetachedAgentSession(cwd, sessionManager) {
	const services = await createAgentSessionServices({ cwd });
	const shellCommandPrefix = buildDetachedShellCommandPrefix(cwd, services.settingsManager.getShellCommandPrefix());
	return createAgentSessionFromServices({
		services,
		sessionManager,
		customTools: [
			createReadToolDefinition(cwd, { autoResizeImages: services.settingsManager.getImageAutoResize() }),
			createBashToolDefinition(cwd, { commandPrefix: shellCommandPrefix }),
			createEditToolDefinition(cwd),
			createWriteToolDefinition(cwd)
		]
	});
}
//#endregion
//#region ../bridge/src/headless-ui-context.ts
function createHeadlessUIContext() {
	const noop = () => {};
	return {
		select: async () => void 0,
		confirm: async () => false,
		input: async () => void 0,
		editor: async () => void 0,
		notify: noop,
		setStatus: noop,
		setWidget: noop,
		setTitle: noop,
		setEditorText: noop,
		getEditorText: () => "",
		onTerminalInput: () => () => {},
		setWorkingMessage: noop,
		setHiddenThinkingLabel: noop,
		setFooter: noop,
		setHeader: noop,
		custom: async () => void 0,
		pasteToEditor: noop,
		setEditorComponent: noop,
		theme: {},
		getAllThemes: () => [],
		getTheme: () => void 0,
		setTheme: () => ({
			success: false,
			error: "Not supported"
		}),
		getToolsExpanded: () => false,
		setToolsExpanded: noop,
		setWorkingVisible: noop,
		setWorkingIndicator: noop,
		addAutocompleteProvider: noop,
		getEditorComponent: () => void 0
	};
}
//#endregion
//#region ../bridge/src/session-registry.ts
var DetachedSessionHandle = class {
	sessionPath;
	sessionManager;
	fallbackCwd;
	onSessionEvent;
	session = null;
	unsubscribeSession = null;
	listeners = /* @__PURE__ */ new Set();
	viewerBinding = null;
	constructor(sessionPath, sessionManager, fallbackCwd, onSessionEvent) {
		this.sessionPath = sessionPath;
		this.sessionManager = sessionManager;
		this.fallbackCwd = fallbackCwd;
		this.onSessionEvent = onSessionEvent;
	}
	getSessionManager() {
		return this.sessionManager;
	}
	getSession() {
		return this.session;
	}
	isActive() {
		return this.session !== null;
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	async bindViewer(binding) {
		this.viewerBinding = binding;
		if (!this.session) return;
		await this.bindSessionExtensions(this.session, binding.uiContext);
	}
	async releaseViewer(clientId) {
		if (!this.viewerBinding || this.viewerBinding.clientId !== clientId) return;
		this.viewerBinding = null;
		if (!this.session) return;
		await this.bindSessionExtensions(this.session, createHeadlessUIContext());
	}
	async ensureSession() {
		if (this.session) return this.session;
		const session = (await createDetachedAgentSession(this.sessionManager.getCwd() || this.fallbackCwd, this.sessionManager)).session;
		const nextSessionPath = session.sessionFile ?? this.sessionPath;
		this.sessionManager = session.sessionManager;
		await this.bindSessionExtensions(session, this.viewerBinding?.uiContext ?? createHeadlessUIContext());
		this.unsubscribeSession = session.subscribe((event) => {
			this.onSessionEvent({
				sessionPath: this.sessionPath,
				event
			});
			for (const listener of this.listeners) listener(event);
		});
		this.session = session;
		if (nextSessionPath !== this.sessionPath) this.sessionPath = nextSessionPath;
		return session;
	}
	dispose() {
		this.unsubscribeSession?.();
		this.unsubscribeSession = null;
		this.session?.dispose();
		this.session = null;
		this.listeners.clear();
		this.viewerBinding = null;
	}
	async bindSessionExtensions(session, uiContext) {
		await session.bindExtensions({
			uiContext,
			onError: (error) => {
				console.error(`DetachedSessionHandle[${path.basename(this.sessionPath)}]: Extension error:`, error);
			},
			shutdownHandler: () => {}
		});
	}
};
var DetachedSessionRegistry = class {
	fallbackCwd;
	handles = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	constructor(fallbackCwd) {
		this.fallbackCwd = fallbackCwd;
	}
	createSession(options) {
		const cwd = options?.cwd?.trim() || this.fallbackCwd;
		const sessionManager = SessionManager.create(cwd, options?.sessionDir);
		const sessionPath = sessionManager.getSessionFile();
		if (!sessionPath) throw new Error("Selected session file not found");
		const handle = new DetachedSessionHandle(sessionPath, sessionManager, this.fallbackCwd, (event) => {
			this.emit(event);
		});
		this.handles.set(sessionPath, handle);
		return handle;
	}
	hasSession(sessionPath) {
		return this.handles.has(sessionPath);
	}
	openSession(sessionPath) {
		const existing = this.handles.get(sessionPath);
		if (existing) return existing;
		const handle = new DetachedSessionHandle(sessionPath, SessionManager.open(sessionPath), this.fallbackCwd, (event) => {
			this.emit(event);
		});
		this.handles.set(sessionPath, handle);
		return handle;
	}
	getHandle(sessionPath) {
		return this.handles.get(sessionPath) ?? null;
	}
	getCachedSessionManagers() {
		return [...this.handles.values()].map((handle) => handle.getSessionManager());
	}
	getCachedSessionManager(sessionPath) {
		return this.handles.get(sessionPath)?.getSessionManager() ?? null;
	}
	getActiveSession(sessionPath) {
		return this.handles.get(sessionPath)?.getSession() ?? null;
	}
	isSessionActive(sessionPath) {
		return this.handles.get(sessionPath)?.isActive() ?? false;
	}
	isSessionRunning(sessionPath) {
		return this.handles.get(sessionPath)?.getSession()?.isStreaming ?? false;
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	async bindViewer(sessionPath, binding) {
		await this.openSession(sessionPath).bindViewer(binding);
	}
	async releaseViewer(sessionPath, clientId) {
		const handle = this.handles.get(sessionPath);
		if (!handle) return;
		await handle.releaseViewer(clientId);
	}
	async ensureSession(sessionPath) {
		return this.openSession(sessionPath).ensureSession();
	}
	removeSession(sessionPath) {
		const handle = this.handles.get(sessionPath);
		if (handle) {
			handle.dispose();
			this.handles.delete(sessionPath);
		}
	}
	dispose() {
		for (const handle of this.handles.values()) handle.dispose();
		this.handles.clear();
		this.listeners.clear();
	}
	emit(event) {
		for (const listener of this.listeners) listener(event);
	}
};
//#endregion
//#region ../bridge/src/types.ts
/** Sensible defaults for bridge configuration. */
const DEFAULT_BRIDGE_CONFIG = {
	host: "0.0.0.0",
	port: 7036,
	portMax: 0,
	uiRequestTimeout: 6e4,
	clientBufferSize: 256
};
//#endregion
//#region src/dev-bridge-reload.ts
const DEV_BIN_ENTRY_SEGMENT = `${sep}packages${sep}bin${sep}src${sep}`;
const DEFAULT_DEBOUNCE_MS = 75;
const IGNORED_DIRECTORIES = new Set([
	".git",
	"dist",
	"node_modules"
]);
function resolveBridgeDevWatchPath(extensionEntryFile) {
	const resolvedEntryFile = resolve(extensionEntryFile);
	const markerIndex = resolvedEntryFile.lastIndexOf(DEV_BIN_ENTRY_SEGMENT);
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
function createBridgeDevReloadController(options) {
	const watchPath = resolveBridgeDevWatchPath(options.extensionEntryFile);
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
					logger.log(`[pi-web] Detected bridge change${changedPath}; reloading /web runtime...`);
					Promise.resolve(options.stop()).catch((error) => {
						logger.error("[pi-web] Failed to stop bridge for hot reload:", error);
					});
				}, debounceMs);
			});
			watcher.on("error", (error) => {
				if (!disposed) logger.error("[pi-web] Bridge dev watcher error:", error);
			});
			watchers.set(directoryPath, watcher);
		}
	};
	refreshWatchers();
	logger.log(`[pi-web] Watching bridge sources: ${watchPath}`);
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
//#region ../bridge/src/bridge-event-bus.ts
/**
* Bridge event bus handles event subscription and fan-out to WebSocket clients.
*
* Features:
* - Subscribe to bridge lifecycle events for terminal log view
* - Fan-out Pi events to all connected WS clients
* - Per-client send buffering with configurable backpressure (drop oldest)
*/
var BridgeEventBus = class {
	handlers = [];
	clients = /* @__PURE__ */ new Map();
	config;
	eventSeq = 0;
	constructor(config) {
		this.config = config;
	}
	/**
	* Subscribe to bridge events.
	* @param handler Callback invoked for each event
	* @returns Unsubscribe function
	*/
	subscribe(handler) {
		this.handlers.push(handler);
		return () => {
			const idx = this.handlers.indexOf(handler);
			if (idx !== -1) this.handlers.splice(idx, 1);
		};
	}
	/**
	* Emit a bridge event to all subscribers.
	*/
	emit(event) {
		for (const handler of this.handlers) try {
			handler(event);
		} catch (err) {
			console.error("BridgeEventBus: handler error:", err);
		}
	}
	/**
	* Register a WebSocket client for event fan-out.
	* @param client Client metadata
	* @param send Function to send data to the client
	* @returns Unregister function
	*/
	registerClient(client, send) {
		const state = {
			client,
			send,
			buffer: [],
			closed: false
		};
		this.clients.set(client.id, state);
		this.flushClient(state);
		return () => {
			this.unregisterClient(client.id);
		};
	}
	/**
	* Unregister a client and discard its buffer.
	*/
	unregisterClient(clientId) {
		const state = this.clients.get(clientId);
		if (state) {
			state.closed = true;
			this.clients.delete(clientId);
		}
	}
	/**
	* Broadcast an event to all connected WS clients.
	* Events are wrapped in the ServerMessage envelope.
	*/
	broadcast(event) {
		this.eventSeq++;
		const data = JSON.stringify({
			type: "event",
			payload: event
		});
		for (const state of this.clients.values()) {
			if (state.closed) continue;
			if (state.buffer.length === 0) try {
				state.send(data);
				continue;
			} catch {}
			this.bufferForClient(state, data);
		}
	}
	/**
	* Get the current send queue depth for a client.
	*/
	getClientQueueDepth(clientId) {
		return this.clients.get(clientId)?.buffer.length ?? 0;
	}
	/**
	* Get queue depth statistics for all clients.
	*/
	getQueueStats() {
		const result = [];
		for (const [clientId, state] of this.clients) result.push({
			clientId,
			depth: state.buffer.length,
			maxDepth: this.config.clientBufferSize
		});
		return result;
	}
	/**
	* Buffer a message for a client, dropping oldest on backpressure.
	*/
	bufferForClient(state, data) {
		if (state.closed) return;
		while (state.buffer.length >= this.config.clientBufferSize) if (state.buffer.shift()) console.warn(`BridgeEventBus: dropping old message for client ${state.client.id} (buffer full)`);
		state.buffer.push({
			payload: data,
			timestamp: Date.now()
		});
		this.flushClient(state);
	}
	/**
	* Flush buffered messages for a client.
	*/
	flushClient(state) {
		if (state.closed) return;
		while (state.buffer.length > 0) {
			const entry = state.buffer[0];
			try {
				state.send(entry.payload);
				state.buffer.shift();
			} catch {
				break;
			}
		}
	}
	/**
	* Dispose the event bus, unregistering all clients.
	*/
	dispose() {
		for (const clientId of this.clients.keys()) this.unregisterClient(clientId);
		this.clients.clear();
		this.handlers.length = 0;
	}
};
//#endregion
//#region ../bridge/src/network.ts
/**
* Network utility functions for the bridge.
*
* Provides helpers for enumerating LAN IP addresses from
* the host's network interfaces.
*/
/**
* Get all LAN-facing IPv4 addresses on this host.
*
* Filters out:
* - Internal/loopback addresses (127.x.x.x)
* - Link-local addresses (169.254.x.x)
* - IPv6 addresses
*
* @returns Array of IPv4 address strings
*/
function getLanIps() {
	const interfaces = os.networkInterfaces();
	const ips = [];
	for (const entries of Object.values(interfaces)) {
		if (!entries) continue;
		for (const entry of entries) {
			if (entry.family !== "IPv4") continue;
			if (entry.internal) continue;
			const addr = entry.address;
			if (addr.startsWith("169.254.")) continue;
			ips.push(addr);
		}
	}
	return ips;
}
/**
* Check if an IPv4 address falls within the Tailscale CGNAT range.
*
* Tailscale assigns IPs from 100.64.0.0/10 (100.64.0.0 – 100.127.255.255).
*
* @param addr IPv4 address string
* @returns true if the address is in the Tailscale range
*/
function isTailscaleIp(addr) {
	const parts = addr.split(".").map(Number);
	if (parts.length !== 4) return false;
	if (parts.some(isNaN)) return false;
	return parts[0] === 100 && (parts[1] & 192) === 64;
}
//#endregion
//#region ../bridge/src/server.ts
/**
* Bridge HTTP and WebSocket server.
*
* Handles:
* - HTTP static file serving from config.staticDir (404 placeholder when no bundle)
* - WebSocket upgrade delegating to a WsConnectionHandler per connection
* - Client tracking with monotonic sequence numbers
*/
/**
* Client counter for monotonic sequence numbers
*/
let clientSeqCounter = 0;
/**
* Generate a unique client ID
*/
function generateClientId() {
	return `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
/**
* Bridge HTTP/WebSocket server
*/
var BridgeServer = class {
	config;
	handlerFactory;
	eventBus;
	emitEvent;
	httpServer;
	wsServer;
	handlers = /* @__PURE__ */ new Map();
	clients = /* @__PURE__ */ new Map();
	isRunning = false;
	host = "localhost";
	port = 0;
	constructor(config, handlerFactory, eventBus, emitEvent) {
		this.config = config;
		this.handlerFactory = handlerFactory;
		this.eventBus = eventBus;
		this.emitEvent = emitEvent;
	}
	/**
	* Start the HTTP and WebSocket server
	* @returns Promise resolving to the bound address
	*/
	async start() {
		if (this.isRunning) throw new Error("Server is already running");
		const startPort = this.config.port || 0;
		const maxPort = this.config.portMax || startPort;
		let boundPort = 0;
		let lastError;
		for (let tryPort = startPort; tryPort <= maxPort || startPort === 0 && tryPort === 0;) try {
			await this.bindToPort(tryPort);
			boundPort = tryPort === 0 ? (this.httpServer?.address())?.port ?? 0 : tryPort;
			break;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (startPort === 0) throw lastError;
			tryPort++;
			if (tryPort > maxPort) throw new Error(`Failed to bind to any port in range ${startPort}-${maxPort}: ${lastError.message}`);
		}
		this.host = this.config.host;
		this.port = boundPort;
		this.isRunning = true;
		this.emitEvent({
			type: "server_start",
			host: this.host,
			port: this.port
		});
		return {
			host: this.host,
			port: this.port
		};
	}
	/**
	* Bind HTTP server to a specific port.
	* Creates a fresh HTTP server each time (Node.js doesn't reliably
	* support re-listening after a bind failure). The WebSocketServer
	* is only attached after the bind succeeds to avoid interference
	* with error handling.
	*/
	bindToPort(port) {
		this.httpServer = void 0;
		this.wsServer = void 0;
		this.httpServer = http.createServer((req, res) => {
			this.handleHttpRequest(req, res);
		});
		return new Promise((resolve, reject) => {
			const server = this.httpServer;
			const onError = (err) => {
				server.off("error", onError);
				server.off("listening", onListening);
				reject(err);
			};
			const onListening = () => {
				server.off("error", onError);
				server.off("listening", onListening);
				this.wsServer = new WebSocketServer({
					server,
					path: "/ws"
				});
				this.wsServer.on("connection", (ws, req) => {
					this.handleWsConnection(ws, req);
				});
				resolve();
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen(port, this.config.host);
		});
	}
	closeWebSocketConnection(ws) {
		return new Promise((resolve) => {
			if (ws.readyState === WebSocket.CLOSED) {
				resolve();
				return;
			}
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutId);
				resolve();
			};
			const timeoutId = setTimeout(() => {
				if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
			}, 500);
			ws.once("close", finish);
			if (ws.readyState === WebSocket.OPEN) ws.close(1001, "server_shutdown");
			else if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
		});
	}
	/**
	* Stop the server and close all connections
	*/
	async stop() {
		if (!this.isRunning) return;
		const openSockets = this.wsServer ? Array.from(this.wsServer.clients) : [];
		for (const [_clientId, handler] of this.handlers) handler.dispose();
		this.handlers.clear();
		this.clients.clear();
		await Promise.all(openSockets.map((ws) => this.closeWebSocketConnection(ws)));
		if (this.wsServer) {
			await new Promise((resolve) => {
				this.wsServer?.close(() => resolve());
			});
			this.wsServer = void 0;
		}
		if (this.httpServer) {
			await new Promise((resolve, reject) => {
				this.httpServer?.close((err) => {
					if (err) reject(err);
					else resolve();
				});
			});
			this.httpServer = void 0;
		}
		this.isRunning = false;
		this.port = 0;
		this.emitEvent({ type: "server_stop" });
	}
	/**
	* Check if the server is running
	*/
	getIsRunning() {
		return this.isRunning;
	}
	/**
	* Get the current server address
	*/
	getAddress() {
		if (!this.isRunning) return void 0;
		return {
			host: this.host,
			port: this.port
		};
	}
	/**
	* Get the number of connected clients
	*/
	getClientCount() {
		return this.clients.size;
	}
	/**
	* Get list of connected clients
	*/
	getClients() {
		return Array.from(this.clients.values());
	}
	/**
	* Handle HTTP requests
	*/
	handleHttpRequest(req, res) {
		if (req.method !== "GET") {
			res.writeHead(405, { "Content-Type": "text/plain" });
			res.end("Method Not Allowed");
			return;
		}
		let pathname = new URL(req.url || "/", `http://${req.headers.host}`).pathname;
		if (pathname === "/") pathname = "/index.html";
		const safePath = path.normalize(pathname).replace(/^(\.\.(\/|$))+/, "");
		if (!this.config.staticDir) {
			if (safePath === "/index.html") {
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(getPlaceholderHtml(this.host, this.port));
			} else {
				res.writeHead(404, { "Content-Type": "text/plain" });
				res.end("Not Found - No web bundle configured");
			}
			return;
		}
		const filePath = path.join(this.config.staticDir, safePath);
		if (!filePath.startsWith(path.resolve(this.config.staticDir))) {
			res.writeHead(403, { "Content-Type": "text/plain" });
			res.end("Forbidden");
			return;
		}
		fs.stat(filePath, (err, stats) => {
			if (err || !stats.isFile()) {
				const indexPath = path.join(this.config.staticDir, "index.html");
				fs.stat(indexPath, (indexErr, indexStats) => {
					if (indexErr || !indexStats.isFile()) {
						res.writeHead(404, { "Content-Type": "text/plain" });
						res.end("Not Found");
						return;
					}
					this.serveFile(indexPath, res);
				});
				return;
			}
			this.serveFile(filePath, res);
		});
	}
	/**
	* Serve a file with appropriate content type
	*/
	serveFile(filePath, res) {
		const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
		fs.readFile(filePath, (err, data) => {
			if (err) {
				res.writeHead(500, { "Content-Type": "text/plain" });
				res.end("Internal Server Error");
				return;
			}
			const body = contentType === "text/html" ? injectRuntimeConfig(data.toString("utf8")) : data;
			res.writeHead(200, {
				"Content-Type": contentType,
				"Cache-Control": "no-cache"
			});
			res.end(body);
		});
	}
	/**
	* Handle WebSocket connection
	*/
	handleWsConnection(ws, _req) {
		clientSeqCounter++;
		const client = {
			id: generateClientId(),
			seq: clientSeqCounter,
			connectedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		this.clients.set(client.id, client);
		const handler = this.handlerFactory({
			client,
			ws,
			config: this.config,
			eventBus: this.eventBus,
			emitEvent: this.emitEvent
		});
		this.handlers.set(client.id, handler);
		const unregister = this.eventBus.registerClient(client, (data) => {
			if (ws.readyState === 1) ws.send(data);
		});
		this.emitEvent({
			type: "client_connect",
			client
		});
		ws.on("close", () => {
			unregister();
			this.handlers.delete(client.id);
			this.clients.delete(client.id);
			this.emitEvent({
				type: "client_disconnect",
				client,
				reason: "websocket_closed"
			});
		});
		ws.on("error", (err) => {
			console.error(`WebSocket error for client ${client.id}:`, err);
			this.emitEvent({
				type: "command_error",
				client,
				commandType: "websocket",
				error: err.message
			});
		});
	}
};
/**
* MIME type mapping
*/
const MIME_TYPES = {
	".html": "text/html",
	".js": "application/javascript",
	".mjs": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".eot": "application/vnd.ms-fontobject"
};
function runtimeDebugModeEnabled() {
	const value = process.env.PI_WEB_DEBUG;
	if (typeof value !== "string") return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true";
}
function injectRuntimeConfig(html) {
	const configScript = `<script>window.__PI_WEB_CONFIG__=${JSON.stringify({ debugModeAvailable: runtimeDebugModeEnabled() })};<\/script>`;
	return html.includes("</head>") ? html.replace("</head>", `${configScript}</head>`) : `${configScript}${html}`;
}
/**
* Get placeholder HTML when no static bundle exists
*/
function getPlaceholderHtml(_host, port) {
	const lanIps = getLanIps();
	const httpUrl = (ip) => `http://${ip}:${port}`;
	const lanUrlLines = lanIps.length > 0 ? lanIps.map((ip) => {
		const label = isTailscaleIp(ip) ? " 🦎 Tailscale" : "";
		return `<span class="code">${httpUrl(ip)}</span>${label}`;
	}).join("<br>\n			") : "";
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Pi Web Bridge</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			max-width: 800px;
			margin: 50px auto;
			padding: 20px;
			line-height: 1.6;
			color: #333;
		}
		.container {
			background: #f5f5f5;
			border-radius: 8px;
			padding: 30px;
		}
		h1 { margin-top: 0; color: #2563eb; }
		.info { background: #e0f2fe; padding: 15px; border-radius: 6px; margin: 20px 0; }
		.lan-info { background: #ecfdf5; padding: 15px; border-radius: 6px; margin: 20px 0; }
		.code { font-family: 'Monaco', 'Menlo', monospace; background: #1e293b; color: #e2e8f0; padding: 2px 6px; border-radius: 3px; }
		.status { display: flex; align-items: center; gap: 10px; margin: 15px 0; }
		.status-dot { width: 10px; height: 10px; background: #22c55e; border-radius: 50%; animation: pulse 2s infinite; }
		@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
	</style>
</head>
<body>
	<div class="container">
		<h1>🌉 Pi Web Bridge</h1>
		<p>The bridge server is running, but no web UI bundle is configured.</p>
		
		<div class="info">
			<strong>Bridge Address:</strong><br>
			<span class="code">http://localhost:${port}</span>
		</div>
		${lanIps.length > 0 ? `<div class="lan-info">
			<strong>📡 LAN Addresses (use on other devices):</strong><br>
			${lanUrlLines}
		</div>` : ""}
		
		<div class="status">
			<div class="status-dot"></div>
			<span>WebSocket endpoint ready</span>
		</div>
		
		<p>To use the web UI, build and configure the static bundle path in the bridge configuration.</p>
	</div>
</body>
</html>`;
}
//#endregion
//#region ../bridge/src/ws-rpc-adapter.ts
function toRpcAgentStartEvent(sessionPath) {
	return {
		type: "agent_start",
		sessionPath: sessionPath ?? void 0
	};
}
function toRpcAgentEndEvent(event, sessionPath) {
	if (!Array.isArray(event.messages)) return {
		type: "agent_end",
		sessionPath: sessionPath ?? void 0
	};
	return {
		type: "agent_end",
		sessionPath: sessionPath ?? void 0,
		messages: event.messages.flatMap((message) => {
			const shaped = toRpcAgentMessage(message);
			return shaped ? [shaped] : [];
		})
	};
}
function toRpcAgentMessage(message) {
	switch (message.role) {
		case "user": return {
			role: "user",
			content: typeof message.content === "string" ? message.content : message.content.map(toRpcAgentTextOrImageContentBlock),
			timestamp: message.timestamp
		};
		case "assistant": return {
			role: "assistant",
			content: message.content.map(toRpcAgentAssistantContentBlock),
			api: message.api,
			provider: message.provider,
			model: message.model,
			responseId: message.responseId,
			usage: {
				input: message.usage.input,
				output: message.usage.output,
				cacheRead: message.usage.cacheRead,
				cacheWrite: message.usage.cacheWrite,
				totalTokens: message.usage.totalTokens,
				cost: {
					input: message.usage.cost.input,
					output: message.usage.cost.output,
					cacheRead: message.usage.cost.cacheRead,
					cacheWrite: message.usage.cost.cacheWrite,
					total: message.usage.cost.total
				}
			},
			stopReason: message.stopReason,
			errorMessage: message.errorMessage,
			timestamp: message.timestamp
		};
		case "toolResult": return {
			role: "toolResult",
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			content: message.content.map(toRpcAgentTextOrImageContentBlock),
			details: message.details,
			isError: message.isError,
			timestamp: message.timestamp
		};
		default: return null;
	}
}
function toRpcAgentTextOrImageContentBlock(block) {
	switch (block.type) {
		case "text": return {
			type: "text",
			text: block.text,
			textSignature: block.textSignature
		};
		case "image": return {
			type: "image",
			data: block.data,
			mimeType: block.mimeType
		};
	}
}
function toRpcAgentAssistantContentBlock(block) {
	switch (block.type) {
		case "text": return {
			type: "text",
			text: block.text,
			textSignature: block.textSignature
		};
		case "thinking": return {
			type: "thinking",
			thinking: block.thinking,
			thinkingSignature: block.thinkingSignature,
			redacted: block.redacted
		};
		case "toolCall": return {
			type: "toolCall",
			id: block.id,
			name: block.name,
			arguments: block.arguments,
			thoughtSignature: block.thoughtSignature
		};
	}
}
function toRpcModel(model) {
	return {
		id: model.id,
		provider: model.provider,
		name: model.name,
		api: model.api,
		reasoning: model.reasoning,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens
	};
}
function isPiModel(value) {
	if (!value || typeof value !== "object") return false;
	const typedValue = value;
	return typeof typedValue.id === "string" && typeof typedValue.provider === "string";
}
function isModelSelectSource(value) {
	return value === "set" || value === "cycle" || value === "restore";
}
function isPiModelSelectEventLike(value) {
	if (!value || typeof value !== "object") return false;
	const typedValue = value;
	return isPiModel(typedValue.model) && (typedValue.previousModel === void 0 || isPiModel(typedValue.previousModel)) && isModelSelectSource(typedValue.source);
}
function toRpcModelSelectEvent(event) {
	return {
		type: "model_select",
		model: toRpcModel(event.model),
		previousModel: event.previousModel ? toRpcModel(event.previousModel) : void 0,
		source: event.source
	};
}
function toRpcCompactionStartEvent(event) {
	return {
		type: "compaction_start",
		reason: event.reason
	};
}
function toRpcCompactionEndEvent(event) {
	return {
		type: "compaction_end",
		reason: event.reason,
		result: event.result ? {
			summary: event.result.summary,
			firstKeptEntryId: event.result.firstKeptEntryId,
			tokensBefore: event.result.tokensBefore,
			details: event.result.details
		} : null,
		aborted: event.aborted,
		willRetry: event.willRetry,
		errorMessage: event.errorMessage
	};
}
const TREE_HARD_HIDDEN_ENTRY_TYPES = new Set(["label"]);
const TREE_SETTINGS_ENTRY_TYPES = new Set([
	"custom",
	"model_change",
	"thinking_level_change",
	"session_info"
]);
function openSessionManager(sessionPath) {
	return SessionManager.open(sessionPath, path.dirname(sessionPath));
}
function sessionTimestampSortValue(timestamp) {
	const parsed = typeof timestamp === "string" && timestamp.trim().length > 0 ? Date.parse(timestamp) : NaN;
	return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
function compareSessionsByRecency(left, right) {
	const timestampDelta = sessionTimestampSortValue(right.updatedAt ?? right.timestamp) - sessionTimestampSortValue(left.updatedAt ?? left.timestamp);
	if (timestampDelta !== 0) return timestampDelta;
	return right.path.localeCompare(left.path);
}
function normalizeOptionalWorkspaceRoot(workspacePath) {
	const trimmed = workspacePath?.trim();
	if (!trimmed) return void 0;
	const normalized = path.normalize(trimmed);
	if (normalized === path.parse(normalized).root) return normalized;
	return normalized.replace(/[\\/]+$/, "");
}
function workspaceDisplayName(workspacePath) {
	return path.basename(workspacePath) || workspacePath || "Unknown workspace";
}
function workspaceMetadata(workspacePath, sessionPath) {
	const fallbackPath = path.dirname(sessionPath);
	const normalizedWorkspacePath = normalizeOptionalWorkspaceRoot(workspacePath) ?? normalizeOptionalWorkspaceRoot(fallbackPath) ?? fallbackPath;
	return {
		workspaceId: normalizedWorkspacePath,
		workspaceName: workspaceDisplayName(normalizedWorkspacePath),
		workspacePath: normalizedWorkspacePath
	};
}
function safeStatMtime(filePath) {
	try {
		return fs.statSync(filePath).mtime.toISOString();
	} catch {
		return;
	}
}
function normalizeSessionTimestamp(timestamp) {
	const value = sessionTimestampSortValue(timestamp);
	return Number.isFinite(value) ? new Date(value).toISOString() : timestamp;
}
function listSessionFilesInDir(sessionDir) {
	try {
		return fs.readdirSync(sessionDir).filter((file) => file.endsWith(".jsonl")).map((file) => path.join(sessionDir, file));
	} catch {
		return [];
	}
}
function getSessionsRoot() {
	return process.env.PI_WEB_SESSIONS_ROOT ?? path.join(os.homedir(), ".pi", "agent", "sessions");
}
function workspaceSessionDirName(workspacePath) {
	return `--${workspacePath.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}
function workspaceSessionDirPath(workspacePath) {
	return path.join(getSessionsRoot(), workspaceSessionDirName(workspacePath));
}
function resolveWorkspaceSessionDirPath(workspacePath) {
	const normalizedWorkspacePath = normalizeOptionalWorkspaceRoot(workspacePath);
	const preferredPath = workspaceSessionDirPath(normalizedWorkspacePath ?? workspacePath);
	if (fs.existsSync(preferredPath)) return preferredPath;
	if (!normalizedWorkspacePath) return preferredPath;
	for (const workspace of listRegisteredWorkspaces()) if (normalizeOptionalWorkspaceRoot(workspace.workspacePath) === normalizedWorkspacePath) return workspace.sessionDir;
	return preferredPath;
}
function isExistingDirectory(directoryPath) {
	try {
		return fs.statSync(directoryPath).isDirectory();
	} catch {
		return false;
	}
}
function resolveExistingWorkspacePathFromEncoded(encoded) {
	const tokens = encoded.split("-").filter(Boolean);
	if (tokens.length === 0) return null;
	const cache = /* @__PURE__ */ new Map();
	const search = (basePath, tokenIndex) => {
		const cacheKey = `${basePath}\0${tokenIndex}`;
		const cached = cache.get(cacheKey);
		if (cached !== void 0) return cached;
		if (tokenIndex >= tokens.length) {
			const resolved = isExistingDirectory(basePath) ? basePath : null;
			cache.set(cacheKey, resolved);
			return resolved;
		}
		for (let length = 1; tokenIndex + length <= tokens.length; length += 1) {
			const segment = tokens.slice(tokenIndex, tokenIndex + length).join("-");
			const candidate = path.join(basePath, segment);
			if (!isExistingDirectory(candidate)) continue;
			const resolved = search(candidate, tokenIndex + length);
			if (resolved) {
				cache.set(cacheKey, resolved);
				return resolved;
			}
		}
		cache.set(cacheKey, null);
		return null;
	};
	return search(path.sep, 0);
}
function decodeWorkspaceSessionDirName(sessionDirName) {
	if (!sessionDirName.startsWith("--") || !sessionDirName.endsWith("--")) return null;
	const encoded = sessionDirName.slice(2, -2);
	if (!encoded) return null;
	const directPath = path.sep + encoded.replace(/-/g, path.sep);
	if (isExistingDirectory(directPath)) return directPath;
	return resolveExistingWorkspacePathFromEncoded(encoded) ?? directPath;
}
function ensureRegisteredWorkspace(workspacePath) {
	const normalizedWorkspacePath = normalizeOptionalWorkspaceRoot(workspacePath);
	if (!normalizedWorkspacePath) throw new Error("Workspace path is required");
	const sessionDir = resolveWorkspaceSessionDirPath(normalizedWorkspacePath);
	const created = !fs.existsSync(sessionDir);
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.rmSync(path.join(sessionDir, ".pi-workspace.json"), { force: true });
	return {
		metadata: workspaceMetadata(normalizedWorkspacePath, sessionDir),
		created
	};
}
function listRegisteredWorkspaces() {
	const sessionsRoot = getSessionsRoot();
	if (!fs.existsSync(sessionsRoot)) return [];
	const workspaces = [];
	for (const entry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const sessionDir = path.join(sessionsRoot, entry.name);
		const workspacePath = normalizeOptionalWorkspaceRoot(resolveWorkspacePathFromSessionDir(sessionDir) ?? decodeWorkspaceSessionDirName(entry.name));
		if (!workspacePath) continue;
		workspaces.push({
			workspacePath,
			sessionDir
		});
	}
	return workspaces;
}
function resolveWorkspacePathFromSessionDir(sessionDir) {
	try {
		const files = fs.readdirSync(sessionDir).filter((file) => file.endsWith(".jsonl"));
		for (const file of files) {
			const cwd = normalizeOptionalWorkspaceRoot(readSessionFileHeader(path.join(sessionDir, file))?.cwd);
			if (cwd) return cwd;
		}
	} catch {}
	return null;
}
function workspaceSummary(workspacePath, updatedAt) {
	const workspace = workspaceMetadata(workspacePath, workspaceSessionDirPath(workspacePath));
	return {
		id: workspace.workspaceId,
		name: workspace.workspaceName,
		path: workspace.workspacePath,
		updatedAt: normalizeSessionTimestamp(updatedAt)
	};
}
function compareWorkspaceSummaries(left, right) {
	const updatedAtDelta = sessionTimestampSortValue(right.updatedAt) - sessionTimestampSortValue(left.updatedAt);
	if (updatedAtDelta !== 0) return updatedAtDelta;
	const nameDelta = left.name.localeCompare(right.name);
	if (nameDelta !== 0) return nameDelta;
	return left.path.localeCompare(right.path);
}
function readWorkspaceUpdatedAt(workspacePath) {
	let latestHeaderTimestamp;
	let latestMtime = Number.NEGATIVE_INFINITY;
	for (const sessionPath of listWorkspaceSessionFiles(workspacePath)) {
		const header = readSessionFileHeader(sessionPath);
		if (header?.timestamp) {
			const normalizedTimestamp = normalizeSessionTimestamp(header.timestamp);
			if (sessionTimestampSortValue(normalizedTimestamp) > sessionTimestampSortValue(latestHeaderTimestamp)) latestHeaderTimestamp = normalizedTimestamp;
		}
		try {
			latestMtime = Math.max(latestMtime, fs.statSync(sessionPath).mtimeMs);
		} catch {}
	}
	return latestHeaderTimestamp ?? (Number.isFinite(latestMtime) ? new Date(latestMtime).toISOString() : void 0);
}
function appendWorkspaceSummary(workspaces, workspacePath, updatedAt) {
	const normalizedWorkspacePath = normalizeOptionalWorkspaceRoot(workspacePath);
	if (!normalizedWorkspacePath) return;
	const existing = workspaces.get(normalizedWorkspacePath);
	const nextUpdatedAt = sessionTimestampSortValue(updatedAt) >= sessionTimestampSortValue(existing?.updatedAt) ? updatedAt : existing?.updatedAt;
	workspaces.set(normalizedWorkspacePath, workspaceSummary(normalizedWorkspacePath, nextUpdatedAt));
}
function pickWorkspaceDirectoryFromNativeDialog() {
	if (process.platform === "darwin") {
		const result = spawnSync("osascript", [
			"-e",
			"set selectedFolder to choose folder with prompt \"Choose a workspace\"",
			"-e",
			"POSIX path of selectedFolder"
		], { encoding: "utf8" });
		if (result.status === 0) return result.stdout.trim() || null;
		return null;
	}
	if (process.platform === "win32") {
		const result = spawnSync("powershell.exe", [
			"-NoProfile",
			"-Command",
			[
				"Add-Type -AssemblyName System.Windows.Forms",
				"$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
				"$dialog.Description = \"Choose a workspace\"",
				"if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
				"  Write-Output $dialog.SelectedPath",
				"}"
			].join("; ")
		], { encoding: "utf8" });
		if (result.status === 0) return result.stdout.trim() || null;
		return null;
	}
	const zenity = spawnSync("zenity", [
		"--file-selection",
		"--directory",
		"--title=Choose a workspace"
	], { encoding: "utf8" });
	if (zenity.status === 0) return zenity.stdout.trim() || null;
	const kdialog = spawnSync("kdialog", [
		"--getexistingdirectory",
		os.homedir(),
		"--title",
		"Choose a workspace"
	], { encoding: "utf8" });
	if (kdialog.status === 0) return kdialog.stdout.trim() || null;
	return null;
}
function listWorkspaceSessionFiles(workspacePath) {
	return listSessionFilesInDir(resolveWorkspaceSessionDirPath(workspacePath));
}
function readFileChunk(filePath, start, length) {
	let fd = null;
	try {
		fd = fs.openSync(filePath, "r");
		const stat = fs.fstatSync(fd);
		const safeStart = Math.max(0, Math.min(start, stat.size));
		const safeLength = Math.max(0, Math.min(length, stat.size - safeStart));
		const buffer = Buffer.alloc(safeLength);
		fs.readSync(fd, buffer, 0, safeLength, safeStart);
		return buffer.toString("utf8");
	} catch {
		return null;
	} finally {
		if (fd !== null) fs.closeSync(fd);
	}
}
function readSessionFilePrefix(filePath, maxBytes = 64 * 1024) {
	return readFileChunk(filePath, 0, maxBytes) ?? "";
}
function parseJsonLine(line) {
	try {
		const value = JSON.parse(line);
		return value && typeof value === "object" ? value : null;
	} catch {
		return null;
	}
}
function parseJsonStringLiteral(value) {
	try {
		const parsed = JSON.parse(value);
		return typeof parsed === "string" ? parsed : void 0;
	} catch {
		return;
	}
}
function extractUserMessageTextFromRawLine(line) {
	if (!/"type"\s*:\s*"message"/.test(line) || !/"role"\s*:\s*"user"/.test(line)) return;
	const contentArrayTextMatch = line.match(/"message"\s*:\s*\{[\s\S]*?"role"\s*:\s*"user"[\s\S]*?"content"\s*:\s*\[[\s\S]*?\{\s*"type"\s*:\s*"text"\s*,\s*"text"\s*:\s*("(?:\\.|[^"\\])*")/);
	const contentStringMatch = line.match(/"message"\s*:\s*\{[\s\S]*?"role"\s*:\s*"user"[\s\S]*?"content"\s*:\s*("(?:\\.|[^"\\])*")/);
	const textFieldMatch = line.match(/"message"\s*:\s*\{[\s\S]*?"role"\s*:\s*"user"[\s\S]*?"text"\s*:\s*("(?:\\.|[^"\\])*")/);
	return [
		contentArrayTextMatch?.[1],
		contentStringMatch?.[1],
		textFieldMatch?.[1]
	].map((value) => value ? parseJsonStringLiteral(value) : void 0).find((value) => typeof value === "string");
}
function findFirstUserMessageText(chunk) {
	for (const line of chunk.split("\n")) {
		const entry = parseJsonLine(line);
		if (entry?.type === "message") {
			const message = entry.message;
			if (message?.role !== "user") continue;
			const text = collapseWhitespace(extractMessageText(message));
			if (text) return text;
			continue;
		}
		const fallbackText = extractUserMessageTextFromRawLine(line);
		if (fallbackText) return collapseWhitespace(fallbackText);
	}
}
function encodeSessionCursor(session) {
	const cursor = {
		updatedAt: session.updatedAt ?? session.timestamp,
		path: session.path
	};
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}
function decodeSessionCursor(value) {
	if (!value) return null;
	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
		return typeof parsed.path === "string" ? {
			updatedAt: parsed.updatedAt,
			path: parsed.path
		} : null;
	} catch {
		return null;
	}
}
function isAfterSessionCursor(session, cursor) {
	if (!cursor) return true;
	return compareSessionsByRecency(session, {
		path: cursor.path,
		updatedAt: cursor.updatedAt,
		timestamp: cursor.updatedAt
	}) > 0;
}
function sessionMatchesListQuery(session, query) {
	const q = query?.trim().toLowerCase();
	if (!q) return true;
	return [
		session.name,
		session.path,
		session.workspaceName,
		session.workspacePath
	].filter(Boolean).some((value) => value.toLowerCase().includes(q));
}
const DEFAULT_PENDING_SESSION_NAME = "New session";
function readSessionFileHeader(sessionPath) {
	const firstLine = readSessionFilePrefix(sessionPath).split("\n", 1)[0];
	const header = parseJsonLine(firstLine);
	if (header?.type !== "session" || typeof header.id !== "string") return null;
	return {
		id: header.id,
		timestamp: typeof header.timestamp === "string" ? header.timestamp : void 0,
		cwd: typeof header.cwd === "string" ? header.cwd : void 0,
		parentSession: typeof header.parentSession === "string" ? header.parentSession : void 0
	};
}
function readWorkspaceSessionSummary(sessionPath, running) {
	const prefix = readSessionFilePrefix(sessionPath);
	const header = readSessionFileHeader(sessionPath);
	if (!header) return null;
	const timestamp = normalizeSessionTimestamp(header.timestamp);
	const mtime = safeStatMtime(sessionPath);
	const workspace = workspaceMetadata(header.cwd, sessionPath);
	const firstUserMessage = findFirstUserMessageText(prefix);
	const explicitName = readLatestSessionInfoName(sessionPath);
	return {
		id: header.id,
		name: explicitName ?? firstUserMessage ?? DEFAULT_PENDING_SESSION_NAME,
		path: sessionPath,
		isRunning: running,
		timestamp,
		updatedAt: normalizeSessionTimestamp(mtime ?? timestamp),
		...workspace,
		parentSession: header.parentSession
	};
}
/**
* Find the name from the latest `session_info` entry in a session file.
* `session_info` entries are appended at the end, so read a tail of the file
* (whole file when small). An empty name clears the title (matches the SDK's
* getSessionName semantics). Returns undefined when no title is set.
*/
function readLatestSessionInfoName(sessionPath, maxTailBytes = 2 * 1024 * 1024) {
	const tailResult = scanTailForLatestSessionInfo(sessionPath, maxTailBytes);
	if (tailResult.found) return tailResult.name;
	return readSessionInfoNameStream(sessionPath);
}
function scanTailForLatestSessionInfo(sessionPath, maxTailBytes) {
	let fd = null;
	try {
		const size = fs.statSync(sessionPath).size;
		if (size === 0) return { found: false };
		const tailSize = Math.min(size, maxTailBytes);
		fd = fs.openSync(sessionPath, "r");
		const buffer = Buffer.alloc(tailSize);
		fs.readSync(fd, buffer, 0, tailSize, Math.max(0, size - tailSize));
		const text = buffer.toString("utf8");
		const firstNewline = text.indexOf("\n");
		return scanLinesForLatestSessionInfo(firstNewline >= 0 ? text.slice(firstNewline + 1) : text);
	} catch {
		return { found: false };
	} finally {
		if (fd !== null) fs.closeSync(fd);
	}
}
function readSessionInfoNameStream(sessionPath) {
	let fd = null;
	try {
		fd = fs.openSync(sessionPath, "r");
		const BUF = 64 * 1024;
		const buffer = Buffer.alloc(BUF);
		let leftover = "";
		let lastName = null;
		while (true) {
			const bytesRead = fs.readSync(fd, buffer, 0, BUF, null);
			if (bytesRead === 0) break;
			const lines = (leftover + buffer.toString("utf8", 0, bytesRead)).split("\n");
			leftover = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				let parsed = null;
				try {
					parsed = JSON.parse(trimmed);
				} catch {
					continue;
				}
				if (parsed && parsed.type === "session_info") lastName = typeof parsed.name === "string" ? parsed.name : null;
			}
		}
		const tail = leftover.trim();
		if (tail) try {
			const parsed = JSON.parse(tail);
			if (parsed && parsed.type === "session_info") lastName = typeof parsed.name === "string" ? parsed.name : null;
		} catch {}
		return lastName ? lastName.trim() || void 0 : void 0;
	} catch {
		return;
	} finally {
		if (fd !== null) fs.closeSync(fd);
	}
}
function scanLinesForLatestSessionInfo(text) {
	let lastName = null;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed = null;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			continue;
		}
		if (parsed && parsed.type === "session_info") lastName = typeof parsed.name === "string" ? parsed.name : null;
	}
	return {
		found: lastName !== null,
		name: lastName ? lastName.trim() || void 0 : void 0
	};
}
function normalizeWorkspacePath(filePath) {
	return filePath.split(path.sep).join("/");
}
function collectWorkspaceEntries(filePaths) {
	const files = /* @__PURE__ */ new Set();
	const directories = /* @__PURE__ */ new Set();
	for (const rawFilePath of filePaths) {
		const filePath = normalizeWorkspacePath(rawFilePath.trim());
		if (!filePath) continue;
		files.add(filePath);
		let currentDir = path.posix.dirname(filePath);
		while (currentDir && currentDir !== ".") {
			if (directories.has(currentDir)) break;
			directories.add(currentDir);
			currentDir = path.posix.dirname(currentDir);
		}
	}
	return [...Array.from(directories).sort((a, b) => a.localeCompare(b)).map((entryPath) => ({
		path: entryPath,
		kind: "directory"
	})), ...Array.from(files).sort((a, b) => a.localeCompare(b)).map((entryPath) => ({
		path: entryPath,
		kind: "file"
	}))];
}
function listWorkspaceFilesWithRipgrep(cwd) {
	const args = [
		"--files",
		"--hidden",
		"--follow",
		"-g",
		"!.git"
	];
	const rootIgnoreFile = path.join(cwd, ".gitignore");
	if (fs.existsSync(rootIgnoreFile)) args.push("--ignore-file", rootIgnoreFile);
	const result = spawnSync("rg", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
		windowsHide: true
	});
	if (result.error || result.status !== 0) return null;
	return result.stdout.split(/\r?\n/).filter(Boolean);
}
function listWorkspaceFilesFallback(cwd) {
	const files = [];
	const stack = [""];
	const rootIgnoreFile = path.join(cwd, ".gitignore");
	const ignoredPatterns = fs.existsSync(rootIgnoreFile) ? new Set(fs.readFileSync(rootIgnoreFile, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"))) : /* @__PURE__ */ new Set();
	while (stack.length > 0) {
		const currentRelativeDir = stack.pop();
		if (currentRelativeDir === void 0) continue;
		const absoluteDir = currentRelativeDir ? path.join(cwd, currentRelativeDir) : cwd;
		let entries = [];
		try {
			entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.name === ".git") continue;
			const relativePath = currentRelativeDir ? path.join(currentRelativeDir, entry.name) : entry.name;
			const absolutePath = path.join(absoluteDir, entry.name);
			const normalizedRelativePath = normalizeWorkspacePath(relativePath);
			if (ignoredPatterns.has(entry.name) || ignoredPatterns.has(normalizedRelativePath)) continue;
			if (entry.isDirectory()) {
				stack.push(relativePath);
				continue;
			}
			if (entry.isFile()) {
				files.push(relativePath);
				continue;
			}
			if (entry.isSymbolicLink()) try {
				const stats = fs.statSync(absolutePath);
				if (stats.isDirectory()) stack.push(relativePath);
				else if (stats.isFile()) files.push(relativePath);
			} catch {}
		}
	}
	return files;
}
function listWorkspaceEntries(cwd) {
	return collectWorkspaceEntries(listWorkspaceFilesWithRipgrep(cwd) ?? listWorkspaceFilesFallback(cwd));
}
/**
* Read a single directory and return its immediate children. Used for
* lazy-loading the file tree — much faster than `listWorkspaceEntries` for
* large workspaces because it doesn't recursively scan the entire tree.
*
* @param workspaceRoot Absolute path to the workspace root.
* @param relativePath Directory path relative to the workspace root (e.g. "src" or "src/components"). Defaults to root.
* @returns Array of directory entries, or an error object.
*/
function listDirectoryEntries(workspaceRoot, relativePath) {
	const normalizedRoot = normalizeOptionalWorkspaceRoot(workspaceRoot);
	if (!normalizedRoot) return { error: "No workspace root" };
	let resolvedRoot;
	try {
		resolvedRoot = fs.realpathSync.native(normalizedRoot);
	} catch {
		return { error: "Workspace root not found" };
	}
	const trimmedRelative = relativePath?.trim() ?? "";
	if (trimmedRelative.split(/[\\/]+/).some((segment) => segment === "..")) return { error: "Path is not inside the current workspace" };
	const absoluteDirPath = trimmedRelative ? path.join(resolvedRoot, trimmedRelative) : resolvedRoot;
	let resolvedDir;
	try {
		resolvedDir = fs.realpathSync.native(absoluteDirPath);
	} catch {
		return { error: "Directory not found" };
	}
	if (!isPathInsideRoot(resolvedRoot, resolvedDir)) return { error: "Path is not inside the current workspace" };
	let stats;
	try {
		stats = fs.statSync(resolvedDir);
	} catch {
		return { error: "Directory not found" };
	}
	if (!stats.isDirectory()) return { error: "Path is not a directory" };
	let items;
	try {
		items = fs.readdirSync(resolvedDir, { withFileTypes: true });
	} catch {
		return { error: "Failed to read directory" };
	}
	const entries = [];
	for (const item of items) {
		if (item.name === ".git") continue;
		const entryRelativePath = trimmedRelative ? `${trimmedRelative}/${item.name}` : item.name;
		if (item.isDirectory()) entries.push({
			path: entryRelativePath,
			kind: "directory"
		});
		else if (item.isFile()) entries.push({
			path: entryRelativePath,
			kind: "file"
		});
	}
	entries.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
		const aName = a.path.includes("/") ? a.path.split("/").pop() ?? a.path : a.path;
		const bName = b.path.includes("/") ? b.path.split("/").pop() ?? b.path : b.path;
		return aName.localeCompare(bName, void 0, { sensitivity: "base" });
	});
	return entries;
}
const MAX_WORKSPACE_FILE_BYTES = 256 * 1024;
function isPathInsideRoot(rootPath, candidatePath) {
	if (candidatePath === rootPath) return true;
	const rootPrefix = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;
	return candidatePath.startsWith(rootPrefix);
}
function resolveWorkspaceFile(cwd, requestedPath) {
	const trimmedPath = requestedPath.trim();
	if (!trimmedPath) return { error: "File path cannot be empty" };
	const workspaceRoot = fs.realpathSync.native(cwd);
	const absolutePath = path.isAbsolute(trimmedPath) ? path.resolve(trimmedPath) : path.resolve(workspaceRoot, trimmedPath);
	if (!fs.existsSync(absolutePath)) return { error: `File not found: ${trimmedPath}` };
	const resolvedPath = fs.realpathSync.native(absolutePath);
	if (!isPathInsideRoot(workspaceRoot, resolvedPath)) return { error: "File must be inside the current workspace" };
	let stats;
	try {
		stats = fs.statSync(resolvedPath);
	} catch {
		return { error: `Failed to stat file: ${trimmedPath}` };
	}
	if (!stats.isFile()) return { error: `Not a file: ${trimmedPath}` };
	return {
		resolvedPath,
		displayPath: normalizeWorkspacePath(path.relative(workspaceRoot, resolvedPath))
	};
}
function readWorkspaceFile(cwd, requestedPath) {
	let resolved;
	try {
		resolved = resolveWorkspaceFile(cwd, requestedPath);
	} catch {
		return { error: "Failed to resolve workspace file" };
	}
	if ("error" in resolved) return resolved;
	let contentBuffer;
	try {
		contentBuffer = fs.readFileSync(resolved.resolvedPath);
	} catch {
		return { error: `Failed to read file: ${requestedPath}` };
	}
	if (contentBuffer.includes(0)) return { error: "Binary file preview is not supported" };
	const truncated = contentBuffer.length > MAX_WORKSPACE_FILE_BYTES;
	const content = (truncated ? contentBuffer.subarray(0, MAX_WORKSPACE_FILE_BYTES) : contentBuffer).toString("utf8");
	return {
		path: resolved.displayPath,
		absolutePath: resolved.resolvedPath,
		content,
		truncated,
		totalBytes: contentBuffer.length,
		lineCount: content.split(/\r?\n/).length
	};
}
function writeWorkspaceFile(cwd, requestedPath, content) {
	if (content.includes("\0")) return { error: "Cannot write binary content" };
	let resolved;
	try {
		resolved = resolveWorkspaceFile(cwd, requestedPath);
	} catch {
		return { error: "Failed to resolve workspace file" };
	}
	if ("error" in resolved) return resolved;
	try {
		fs.writeFileSync(resolved.resolvedPath, content, "utf8");
	} catch (err) {
		return { error: err instanceof Error ? `Failed to write file: ${err.message}` : "Failed to write file" };
	}
	return {
		path: resolved.displayPath,
		absolutePath: resolved.resolvedPath,
		bytesWritten: Buffer.byteLength(content, "utf8")
	};
}
function runGitCommand(cwd, args, timeout = 2e3) {
	return spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		timeout,
		windowsHide: true
	});
}
function readSpawnText(value) {
	if (typeof value === "string") return value;
	if (!value) return "";
	return Buffer.from(value).toString("utf8");
}
function getCurrentGitBranch(cwd) {
	return readGitRepoState(cwd)?.headLabel;
}
function readGitRepoState(cwd) {
	if (!cwd) return null;
	const repoRootResult = runGitCommand(cwd, ["rev-parse", "--show-toplevel"]);
	if (repoRootResult.error || repoRootResult.status !== 0) return null;
	const repoRoot = readSpawnText(repoRootResult.stdout).trim();
	if (!repoRoot) return null;
	const currentBranchResult = runGitCommand(repoRoot, [
		"symbolic-ref",
		"--quiet",
		"--short",
		"HEAD"
	]);
	const currentBranch = currentBranchResult.error || currentBranchResult.status !== 0 ? void 0 : readSpawnText(currentBranchResult.stdout).trim() || void 0;
	const headShaResult = runGitCommand(repoRoot, [
		"rev-parse",
		"--short",
		"HEAD"
	]);
	const headSha = headShaResult.error || headShaResult.status !== 0 ? void 0 : readSpawnText(headShaResult.stdout).trim() || void 0;
	const branchesResult = runGitCommand(repoRoot, [
		"for-each-ref",
		"--format=%(refname)	%(refname:short)	%(HEAD)",
		"refs/heads",
		"refs/remotes"
	]);
	if (branchesResult.error || branchesResult.status !== 0) return null;
	const branches = readSpawnText(branchesResult.stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
		const [refName = "", shortName = "", headMarker = ""] = line.split("	");
		if (!refName || !shortName) return [];
		if (refName.startsWith("refs/remotes/") && shortName.endsWith("/HEAD")) return [];
		if (refName.startsWith("refs/heads/")) return [{
			name: shortName,
			shortName,
			kind: "local",
			isCurrent: headMarker === "*"
		}];
		if (refName.startsWith("refs/remotes/")) {
			const [remoteName, ...rest] = shortName.split("/");
			return [{
				name: shortName,
				shortName: rest.join("/") || shortName,
				kind: "remote",
				remoteName,
				isCurrent: headMarker === "*"
			}];
		}
		return [];
	}).sort((left, right) => {
		if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
		if (left.kind !== right.kind) return left.kind === "local" ? -1 : 1;
		return left.name.localeCompare(right.name);
	});
	const dirtyResult = runGitCommand(repoRoot, ["status", "--porcelain"]);
	const isDirty = !dirtyResult.error && dirtyResult.status === 0 ? readSpawnText(dirtyResult.stdout).trim().length > 0 : false;
	return {
		repoRoot,
		headLabel: currentBranch ?? (headSha ? `detached@${headSha}` : "detached"),
		currentBranch,
		detached: !currentBranch,
		isDirty,
		branches
	};
}
/**
* Maximum number of diff lines to emit per file. If a single file has more
* lines than this across all hunks, the parser truncates to keep payloads
* reasonable. Files at the limit can still be huge — this is a guardrail,
* not a guarantee.
*/
const PARSE_DIFF_MAX_LINES_PER_FILE = 5e3;
const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
function parseDiffHunkHeader(line) {
	const match = HUNK_HEADER_REGEX.exec(line);
	if (!match) return null;
	return {
		oldStart: Number(match[1]),
		oldCount: match[2] !== void 0 ? Number(match[2]) : 1,
		newStart: Number(match[3]),
		newCount: match[4] !== void 0 ? Number(match[4]) : 1
	};
}
/**
* Parse `git diff --no-color` output into structured diff entries.
*
* Returns an empty array if the directory is not a git repository, git is
* unavailable, or the working tree has no unstaged changes. Each file's
* diff is parsed into a sequence of hunks with typed lines (context/added/
* deleted) and tracked line numbers.
*/
function parseGitDiff(cwd) {
	const diffResult = runGitCommand(cwd, [
		"diff",
		"--no-color",
		"--no-ext-diff",
		"--unified=3"
	], 1e4);
	if (diffResult.error || diffResult.status !== 0) return [];
	const rawOutput = readSpawnText(diffResult.stdout);
	if (!rawOutput) return [];
	const entries = [];
	const lines = rawOutput.split(/\r?\n/);
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		if (!line.startsWith("diff --git ")) {
			i += 1;
			continue;
		}
		i += 1;
		let status = "modified";
		let isBinary = false;
		let oldPath;
		let filePath = "";
		let explicitModeSet = false;
		while (i < lines.length) {
			const headerLine = lines[i] ?? "";
			if (headerLine.startsWith("diff --git ")) break;
			if (headerLine.startsWith("@@ ")) break;
			if (headerLine.startsWith("new file mode ")) {
				status = "added";
				explicitModeSet = true;
			} else if (headerLine.startsWith("deleted file mode ")) {
				status = "deleted";
				explicitModeSet = true;
			} else if (headerLine.startsWith("rename from ")) {
				status = "renamed";
				oldPath = headerLine.slice(12);
			} else if (headerLine.startsWith("rename to ")) {
				status = "renamed";
				filePath = headerLine.slice(10);
			} else if (headerLine.startsWith("Binary files ")) isBinary = true;
			else if (headerLine.startsWith("similarity index ")) {
				if (!explicitModeSet && status === "modified") status = "renamed";
			}
			i += 1;
		}
		if (!filePath) {
			const headerMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
			if (headerMatch) {
				oldPath = oldPath ?? headerMatch[1];
				filePath = headerMatch[2];
			}
		}
		if (!filePath) continue;
		const hunks = [];
		let truncated = false;
		while (i < lines.length) {
			const bodyLine = lines[i] ?? "";
			if (bodyLine.startsWith("diff --git ")) break;
			if (!bodyLine.startsWith("@@ ")) {
				i += 1;
				continue;
			}
			const hunkHeader = parseDiffHunkHeader(bodyLine);
			if (!hunkHeader) {
				i += 1;
				continue;
			}
			i += 1;
			const hunkLines = [];
			let oldLineNo = hunkHeader.oldStart;
			let newLineNo = hunkHeader.newStart;
			let consumed = 0;
			const expectedCount = hunkHeader.oldCount + hunkHeader.newCount;
			while (i < lines.length && consumed < expectedCount) {
				const hunkLine = lines[i] ?? "";
				if (hunkLine.startsWith("diff --git ")) break;
				if (hunkLine.startsWith("@@ ")) break;
				if (hunkLine.startsWith("\\")) {
					i += 1;
					continue;
				}
				let content;
				if (hunkLine.startsWith("+")) {
					content = hunkLine.slice(1);
					hunkLines.push({
						type: "added",
						content,
						newLineNo
					});
					newLineNo += 1;
					consumed += 1;
					i += 1;
					continue;
				}
				if (hunkLine.startsWith("-")) {
					content = hunkLine.slice(1);
					hunkLines.push({
						type: "deleted",
						content,
						oldLineNo
					});
					oldLineNo += 1;
					consumed += 1;
					i += 1;
					continue;
				}
				if (hunkLine.startsWith(" ")) {
					content = hunkLine.slice(1);
					hunkLines.push({
						type: "context",
						content,
						oldLineNo,
						newLineNo
					});
					oldLineNo += 1;
					newLineNo += 1;
					consumed += 1;
					i += 1;
					continue;
				}
				if (hunkLine === "") {
					hunkLines.push({
						type: "context",
						content: "",
						oldLineNo,
						newLineNo
					});
					oldLineNo += 1;
					newLineNo += 1;
					consumed += 1;
					i += 1;
					continue;
				}
				break;
			}
			if (hunkLines.length > 0) hunks.push({
				...hunkHeader,
				lines: hunkLines
			});
			if (hunks.reduce((sum, h) => sum + h.lines.length, 0) >= PARSE_DIFF_MAX_LINES_PER_FILE) {
				truncated = true;
				break;
			}
		}
		const entry = {
			path: filePath,
			status,
			hunks
		};
		if (status === "renamed" && oldPath) entry.oldPath = oldPath;
		if (isBinary || truncated) entry.isBinary = isBinary || void 0;
		entries.push(entry);
	}
	return entries;
}
function isTreeSettingsEntry(type) {
	return TREE_SETTINGS_ENTRY_TYPES.has(type);
}
function getTreeEntryRole(entry) {
	const entryType = typeof entry.type === "string" ? entry.type : void 0;
	if (entryType === "message") {
		const messageRole = typeof entry.message?.role === "string" ? entry.message.role : typeof entry.role === "string" ? entry.role : void 0;
		if (messageRole === "user") return "user";
		if (messageRole === "assistant") return "assistant";
		if (messageRole === "toolResult" || messageRole === "bashExecution") return "tool";
		return "other";
	}
	if (entryType === "custom" || entryType === "model_change" || entryType === "thinking_level_change" || entryType === "session_info" || entryType === "compaction" || entryType === "branch_summary") return "meta";
	return "other";
}
function isToolOnlyAssistantEntry(entry) {
	if (entry.type !== "message") return false;
	const message = entry.message;
	if (!message || message.role !== "assistant") return false;
	if (collapseWhitespace(extractMessageText(message))) return false;
	if (message.stopReason === "aborted") return false;
	return !message.errorMessage;
}
function buildTreePreviewText(entry) {
	if (entry.type === "message" && "message" in entry) {
		const message = entry.message;
		const content = collapseWhitespace(extractMessageText(message));
		switch (message.role) {
			case "user": return content || "user";
			case "assistant":
				if (content) return content;
				if (message.stopReason === "aborted") return "(aborted)";
				if (message.errorMessage) return collapseWhitespace(message.errorMessage);
				return "(no content)";
			case "toolResult": return message.toolName ? `[tool: ${message.toolName}]` : "[tool result]";
			case "bashExecution": return message.command ? `[bash]: ${collapseWhitespace(message.command)}` : "[bash]";
			default: return describeMessage(message);
		}
	}
	if (typeof entry.role === "string") {
		const role = entry.role;
		const content = collapseWhitespace(extractMessageText(entry));
		if (role === "user") return content || "user";
		if (role === "assistant") return content || "assistant";
		return content ? `${role}: ${content}` : `[${role}]`;
	}
	return describeSessionEntry(entry);
}
function buildTreeSearchText(entryLabel, previewText, entryType, role, labelTag) {
	return [
		labelTag,
		previewText,
		entryLabel,
		entryType,
		role
	].filter((value) => typeof value === "string" && value.trim().length > 0).join(" ");
}
function buildTreeEntryPresentation(entry, entryLabel, labelTag) {
	const entryType = typeof entry.type === "string" ? entry.type : typeof entry.role === "string" ? entry.role : "unknown";
	const role = getTreeEntryRole(entry);
	const previewText = buildTreePreviewText(entry);
	return {
		role,
		labelTag,
		previewText,
		searchText: buildTreeSearchText(entryLabel, previewText, entryType, role, labelTag),
		isSettingsEntry: isTreeSettingsEntry(entryType),
		isLabeled: Boolean(labelTag),
		isToolOnlyAssistant: isToolOnlyAssistantEntry(entry)
	};
}
function buildVisibleTree(nodes, activeLeafId) {
	const visibleNodes = [];
	for (const node of nodes) {
		const visibleChildren = buildVisibleTree(node.children, activeLeafId);
		const containsActiveLeaf = node.entry.id === activeLeafId || visibleChildren.some((child) => child.containsActiveLeaf);
		if (TREE_HARD_HIDDEN_ENTRY_TYPES.has(node.entry.type)) {
			visibleNodes.push(...visibleChildren);
			continue;
		}
		visibleNodes.push({
			entry: node.entry,
			children: visibleChildren,
			label: node.label,
			containsActiveLeaf
		});
	}
	return visibleNodes;
}
function flattenVisibleTree(nodes) {
	const entries = [];
	const multipleRoots = nodes.length > 1;
	const orderedRoots = orderTreeChildren(nodes);
	const stack = [];
	for (let index = orderedRoots.length - 1; index >= 0; index--) stack.push({
		node: orderedRoots[index],
		indent: multipleRoots ? 1 : 0,
		justBranched: multipleRoots,
		showConnector: multipleRoots,
		isLast: index === orderedRoots.length - 1,
		gutters: [],
		isVirtualRootChild: multipleRoots,
		parentId: null
	});
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		const { node, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild, parentId } = current;
		const displayIndent = multipleRoots ? Math.max(0, indent - 1) : indent;
		const connectorDisplayed = showConnector && !isVirtualRootChild;
		const connectorPosition = connectorDisplayed ? Math.max(0, displayIndent - 1) : -1;
		const children = orderTreeChildren(node.children);
		const hasActiveChild = children.some((child) => child.containsActiveLeaf);
		const entryLabel = formatTreeEntryLabel(node);
		const presentation = buildTreeEntryPresentation(node.entry, entryLabel, node.label);
		entries.push({
			id: node.entry.id,
			parentId,
			label: entryLabel,
			type: node.entry.type,
			timestamp: node.entry.timestamp,
			depth: displayIndent,
			trackColumns: buildTrackColumns(displayIndent, connectorPosition, isLast, gutters),
			isActive: node.containsActiveLeaf && !hasActiveChild,
			isOnActivePath: node.containsActiveLeaf,
			role: presentation.role,
			labelTag: presentation.labelTag,
			previewText: presentation.previewText,
			searchText: presentation.searchText,
			isSettingsEntry: presentation.isSettingsEntry,
			isLabeled: presentation.isLabeled,
			isToolOnlyAssistant: presentation.isToolOnlyAssistant
		});
		const multipleChildren = children.length > 1;
		const childIndent = multipleChildren ? indent + 1 : justBranched && indent > 0 ? indent + 1 : indent;
		const childGutters = connectorDisplayed ? [...gutters, {
			position: connectorPosition,
			show: !isLast
		}] : gutters;
		for (let index = children.length - 1; index >= 0; index--) stack.push({
			node: children[index],
			indent: childIndent,
			justBranched: multipleChildren,
			showConnector: multipleChildren,
			isLast: index === children.length - 1,
			gutters: childGutters,
			isVirtualRootChild: false,
			parentId: node.entry.id
		});
	}
	return entries;
}
function buildTrackColumns(displayIndent, connectorPosition, isLast, gutters) {
	const columns = [];
	for (let level = 0; level < displayIndent; level++) {
		const gutter = gutters.find((item) => item.position === level);
		if (gutter) {
			columns.push(gutter.show ? "line" : "blank");
			continue;
		}
		if (connectorPosition === level) {
			columns.push(isLast ? "branch-last" : "branch");
			continue;
		}
		columns.push("blank");
	}
	return columns;
}
function orderTreeChildren(children) {
	const activeChildren = children.filter((child) => child.containsActiveLeaf);
	const inactiveChildren = children.filter((child) => !child.containsActiveLeaf);
	return [...activeChildren, ...inactiveChildren];
}
function buildTreeEntriesFromSession(sessionManager) {
	const activeLeafId = sessionManager.getLeafId();
	return flattenVisibleTree(orderTreeChildren(buildVisibleTree(sessionManager.getTree(), activeLeafId)));
}
function buildTreeEntriesFromBranch(branch) {
	const visibleEntries = branch.filter((entry) => {
		const typedEntry = entry;
		if (!typedEntry.id) return false;
		if (typedEntry.type && TREE_HARD_HIDDEN_ENTRY_TYPES.has(typedEntry.type)) return false;
		return true;
	});
	return visibleEntries.map((entry, index) => {
		const typedEntry = entry;
		const type = typeof typedEntry.type === "string" ? typedEntry.type : typedEntry.role ?? "unknown";
		const entryLabel = formatFallbackTreeEntryLabel(typedEntry);
		const presentation = buildTreeEntryPresentation(typedEntry, entryLabel);
		return {
			id: String(typedEntry.id),
			parentId: index === 0 ? null : String(visibleEntries[index - 1].id ?? ""),
			label: entryLabel,
			type,
			timestamp: typeof typedEntry.timestamp === "string" ? typedEntry.timestamp : void 0,
			depth: 0,
			trackColumns: [],
			isActive: index === visibleEntries.length - 1,
			isOnActivePath: true,
			role: presentation.role,
			labelTag: presentation.labelTag,
			previewText: presentation.previewText,
			searchText: presentation.searchText,
			isSettingsEntry: presentation.isSettingsEntry,
			isLabeled: presentation.isLabeled,
			isToolOnlyAssistant: presentation.isToolOnlyAssistant
		};
	});
}
function buildTreeEntriesForSessionPath(sessionPath) {
	return buildTreeEntriesFromSession(openSessionManager(sessionPath));
}
function projectTreeEntriesWithTranscriptMessage(entries, message) {
	const projectedEntryId = message.id ?? message.transcriptKey;
	if (!projectedEntryId) return [...entries];
	const [projectedEntry] = buildTreeEntriesFromBranch([{
		id: projectedEntryId,
		role: message.role,
		content: message.content,
		text: message.text,
		timestamp: message.timestamp,
		type: message.role
	}]);
	if (!projectedEntry) return [...entries];
	const nextEntries = entries.map((entry) => ({
		...entry,
		isActive: false
	}));
	const existingIndex = nextEntries.findIndex((entry) => entry.id === projectedEntryId || entry.id === message.transcriptKey);
	if (existingIndex >= 0) {
		const existingEntry = nextEntries[existingIndex];
		nextEntries[existingIndex] = {
			...existingEntry,
			...projectedEntry,
			id: projectedEntryId,
			parentId: existingEntry.parentId ?? projectedEntry.parentId ?? null,
			depth: existingEntry.depth ?? projectedEntry.depth,
			trackColumns: existingEntry.trackColumns ?? projectedEntry.trackColumns,
			isActive: true,
			isOnActivePath: true
		};
		return nextEntries;
	}
	const activeParent = [...nextEntries].reverse().find((entry) => entry.isOnActivePath);
	nextEntries.push({
		...projectedEntry,
		id: projectedEntryId,
		parentId: activeParent?.id ?? null,
		isActive: true,
		isOnActivePath: true
	});
	return nextEntries;
}
function transcriptMessageFromBranchEntry(entry, fallbackKey) {
	if (!entry || typeof entry !== "object") return null;
	const typedEntry = entry;
	if (typedEntry.type === "message" && typedEntry.message && typeof typedEntry.message === "object") {
		const message = typedEntry.message;
		const id = typeof typedEntry.id === "string" ? typedEntry.id : void 0;
		const role = typeof message.role === "string" ? message.role : null;
		if (!role) return null;
		return {
			...message,
			transcriptKey: id ?? fallbackKey,
			id,
			role,
			timestamp: typeof typedEntry.timestamp === "string" ? typedEntry.timestamp : void 0
		};
	}
	if (typedEntry.type) return transcriptMessageFromSessionEntry(typedEntry, fallbackKey);
	if (typeof typedEntry.role === "string") {
		const flatMessage = typedEntry;
		const id = typeof typedEntry.id === "string" ? typedEntry.id : void 0;
		return {
			...flatMessage,
			transcriptKey: id ?? fallbackKey,
			id,
			role: typedEntry.role,
			timestamp: typeof typedEntry.timestamp === "string" ? typedEntry.timestamp : void 0
		};
	}
	return null;
}
function transcriptMessageFromSessionEntry(entry, fallbackKey) {
	const id = typeof entry.id === "string" ? entry.id : void 0;
	const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : void 0;
	switch (entry.type) {
		case "compaction": return {
			transcriptKey: id ?? fallbackKey,
			id,
			role: "system",
			timestamp,
			content: [{
				type: "compaction",
				summary: entry.summary,
				tokensBefore: entry.tokensBefore,
				firstKeptEntryId: entry.firstKeptEntryId
			}]
		};
		case "branch_summary": return {
			transcriptKey: id ?? fallbackKey,
			id,
			role: "system",
			timestamp,
			content: [{
				type: "branch_summary",
				summary: entry.summary,
				fromId: entry.fromId
			}]
		};
		case "model_change": return {
			transcriptKey: id ?? fallbackKey,
			id,
			role: "system",
			timestamp,
			content: [{
				type: "model_change",
				provider: entry.provider,
				modelId: entry.modelId
			}]
		};
		case "thinking_level_change": return {
			transcriptKey: id ?? fallbackKey,
			id,
			role: "system",
			timestamp,
			content: [{
				type: "thinking_level_change",
				thinkingLevel: entry.thinkingLevel
			}]
		};
		case "session_info": return null;
		default: return null;
	}
}
function flattenMessagesForTranscript(branch) {
	const messages = [];
	for (let index = 0; index < branch.length; index += 1) {
		const message = transcriptMessageFromBranchEntry(branch[index], `snapshot:${index}`);
		if (message) messages.push(message);
	}
	return filterBootstrapTranscriptMessages(messages);
}
function trimAssistantContentToToolCall(content, toolCallId) {
	if (!Array.isArray(content)) return {
		content,
		found: false
	};
	const trimmed = [];
	for (const block of content) {
		trimmed.push(block);
		if (typeof block === "object" && block !== null && block.type === "toolCall" && block.id === toolCallId) return {
			content: trimmed,
			found: true
		};
	}
	return {
		content,
		found: false
	};
}
function buildExactSelectionTranscriptMessages(branch, targetEntryId) {
	const messages = flattenMessagesForTranscript(branch);
	const targetIndex = messages.findIndex((message) => message.id === targetEntryId);
	if (targetIndex === -1) return messages;
	const targetMessage = messages[targetIndex];
	if (targetMessage.role !== "toolResult" || typeof targetMessage.toolCallId !== "string" || !targetMessage.toolCallId) return messages;
	for (let index = targetIndex - 1; index >= 0; index -= 1) {
		const candidate = messages[index];
		if (candidate.role !== "assistant") continue;
		const trimmed = trimAssistantContentToToolCall(candidate.content, targetMessage.toolCallId);
		if (!trimmed.found) return messages;
		const nextMessages = [...messages];
		nextMessages[index] = {
			...candidate,
			content: trimmed.content
		};
		return nextMessages;
	}
	return messages;
}
function filterBootstrapTranscriptMessages(messages) {
	if (messages.length === 0) return [];
	if (messages.some((message) => !isBootstrapTranscriptMessage(message))) return [...messages];
	return [];
}
function isBootstrapTranscriptMessage(message) {
	if (message.role !== "system" || !Array.isArray(message.content)) return false;
	if (message.content.length !== 1) return false;
	const [block] = message.content;
	if (typeof block !== "object" || block === null) return false;
	const type = block.type;
	return type === "model_change" || type === "thinking_level_change";
}
function normalizeTranscriptPageLimit(limit) {
	if (typeof limit !== "number" || !Number.isFinite(limit)) return 40;
	return Math.min(100, Math.max(1, Math.trunc(limit)));
}
function encodeTranscriptCursor(index) {
	return `i:${index}`;
}
function decodeTranscriptCursor(cursor) {
	if (typeof cursor !== "string") return null;
	const matched = /^i:(\d+)$/.exec(cursor);
	if (!matched) return null;
	const index = Number.parseInt(matched[1], 10);
	return Number.isInteger(index) ? index : null;
}
function buildTranscriptPage(messages, sessionPath, options) {
	const limit = normalizeTranscriptPageLimit(options?.limit);
	const total = messages.length;
	if (total === 0) return {
		sessionPath: sessionPath ?? void 0,
		messages: [],
		hasOlder: false,
		hasNewer: false
	};
	const direction = options?.direction ?? "latest";
	let start = Math.max(0, total - limit);
	let end = total;
	if (direction === "older") {
		const cursorIndex = decodeTranscriptCursor(options?.cursor);
		const upperBound = cursorIndex == null ? Math.max(0, total - 1) : Math.min(total - 1, cursorIndex);
		end = Math.max(0, upperBound);
		start = Math.max(0, end - limit);
	}
	const pageMessages = messages.slice(start, end);
	const hasOlder = start > 0;
	const hasNewer = end < total;
	return {
		sessionPath: sessionPath ?? void 0,
		messages: pageMessages,
		oldestCursor: pageMessages.length > 0 ? encodeTranscriptCursor(start) : void 0,
		newestCursor: pageMessages.length > 0 ? encodeTranscriptCursor(end - 1) : void 0,
		hasOlder,
		hasNewer
	};
}
function extractEventMessage(event) {
	if (!event || typeof event !== "object") return null;
	const typedEvent = event;
	if (typedEvent.message && typeof typedEvent.message === "object") return typedEvent.message;
	if (typeof typedEvent.role === "string") return event;
	return null;
}
function toolCallDeltaMetadata(item) {
	if (!item || typeof item !== "object" || item.type !== "toolCall") return {};
	return {
		toolCallId: typeof item.id === "string" ? item.id : void 0,
		toolName: typeof item.name === "string" ? item.name : void 0
	};
}
function extractAssistantMessageDeltaEvent(event, message) {
	if (!event || typeof event !== "object") return null;
	const assistantMessageEvent = event.assistantMessageEvent;
	if (!assistantMessageEvent || typeof assistantMessageEvent !== "object") return null;
	const data = assistantMessageEvent;
	if (typeof data.contentIndex !== "number" || !Number.isInteger(data.contentIndex) || data.contentIndex < 0 || typeof data.delta !== "string") return null;
	switch (data.type) {
		case "text_delta": return {
			blockType: "text",
			contentIndex: data.contentIndex,
			delta: data.delta
		};
		case "thinking_delta": return {
			blockType: "thinking",
			contentIndex: data.contentIndex,
			delta: data.delta
		};
		case "toolcall_delta": return {
			blockType: "toolCall",
			contentIndex: data.contentIndex,
			delta: data.delta,
			...toolCallDeltaMetadata(transcriptContentItems(message)[data.contentIndex])
		};
		default: return null;
	}
}
function transcriptContentItems(message) {
	if (Array.isArray(message.content)) return message.content;
	if (typeof message.content === "string") return [message.content];
	if (typeof message.text === "string") return [message.text];
	return [];
}
function stringFromToolArguments(value) {
	if (typeof value === "string") return value;
	if (value === void 0 || value === null) return "";
	try {
		return JSON.stringify(value);
	} catch {
		return "";
	}
}
function streamTextForContentItem(item) {
	if (typeof item === "string") return {
		blockType: "text",
		text: item
	};
	if (!item || typeof item !== "object") return null;
	switch (item.type) {
		case "text": return {
			blockType: "text",
			text: item.text
		};
		case "thinking": return {
			blockType: "thinking",
			text: item.thinking
		};
		case "toolCall": return {
			blockType: "toolCall",
			text: stringFromToolArguments(item.arguments)
		};
		default: return null;
	}
}
function synthesizeTranscriptDelta(previous, next) {
	const previousItems = previous ? transcriptContentItems(previous) : [];
	const nextItems = transcriptContentItems(next);
	for (let index = 0; index < nextItems.length; index += 1) {
		const nextText = streamTextForContentItem(nextItems[index]);
		if (!nextText) continue;
		const previousText = streamTextForContentItem(previousItems[index]);
		const previousValue = previousText?.blockType === nextText.blockType ? previousText.text : "";
		if (!nextText.text.startsWith(previousValue)) continue;
		const delta = nextText.text.slice(previousValue.length);
		if (!delta) continue;
		return {
			blockType: nextText.blockType,
			contentIndex: index,
			delta,
			...toolCallDeltaMetadata(nextItems[index])
		};
	}
	return null;
}
function streamStartMessage(message) {
	if (message.role !== "assistant") return message;
	return {
		...message,
		content: [],
		text: void 0
	};
}
function findLatestModelInfo(branch) {
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type === "model_change") return {
			provider: entry.provider,
			id: entry.modelId
		};
	}
	return null;
}
function normalizeThinkingLevel(value) {
	switch (value) {
		case "off":
		case "minimal":
		case "low":
		case "medium":
		case "high":
		case "xhigh": return value;
		default: return "off";
	}
}
function buildStateFromStoredSession(sessionManager, fallbackCwd) {
	const branch = sessionManager.getBranch();
	const context = sessionManager.buildSessionContext();
	const model = findLatestModelInfo(branch);
	const workspacePath = normalizeOptionalWorkspaceRoot(sessionManager.getCwd()) ?? normalizeOptionalWorkspaceRoot(fallbackCwd) ?? fallbackCwd;
	const workspaceEnvironments = detectWorkspaceEnvironments(workspacePath);
	return {
		model: model ?? void 0,
		thinkingLevel: normalizeThinkingLevel(context.thinkingLevel),
		isStreaming: false,
		isCompacting: false,
		steeringMode: "all",
		followUpMode: "all",
		sessionFile: sessionManager.getSessionFile(),
		sessionId: sessionManager.getSessionId(),
		sessionName: sessionDisplayName(sessionManager, sessionManager.getSessionFile()),
		workspacePath,
		...workspaceEnvironments ? { workspaceEnvironments } : {},
		gitBranch: getCurrentGitBranch(workspacePath),
		autoCompactionEnabled: true,
		messageCount: sessionManager.getEntries()?.length ?? 0,
		pendingMessageCount: 0
	};
}
function formatTreeEntryLabel(node) {
	return `${node.label ? `[${node.label}] ` : ""}${describeSessionEntry(node.entry)}`.trim();
}
function summarizeTokenUsage(branch, entries) {
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	let totalCost = 0;
	let lastAssistantUsage = null;
	let lastModel = null;
	for (const entry of branch) {
		const e = entry;
		if (e.type === "model_change") lastModel = {
			provider: e.provider,
			modelId: e.modelId
		};
		if (e.type === "message" && e.message?.role === "assistant") {
			const usage = e.message.usage;
			if (!usage) continue;
			inputTokens += usage.input ?? 0;
			outputTokens += usage.output ?? 0;
			cacheReadTokens += usage.cacheRead ?? 0;
			cacheWriteTokens += usage.cacheWrite ?? 0;
			totalCost += usage.cost?.total ?? 0;
			if ((usage.input ?? 0) > 0) lastAssistantUsage = usage;
		}
	}
	return {
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		messageCount: entries?.length ?? 0,
		totalCost,
		lastAssistantUsage,
		lastModel
	};
}
function sessionDisplayName(sessionManager, _sessionPath) {
	const explicitName = sessionManager.getSessionName()?.trim();
	if (explicitName) return explicitName;
	const firstUserEntry = sessionManager.getEntries().find((entry) => {
		if (typeof entry === "object" && entry !== null && "type" in entry && entry.type === "message" && "message" in entry) return entry.message.role === "user";
		if (typeof entry === "object" && entry !== null && "role" in entry) return entry.role === "user";
		return false;
	});
	if (firstUserEntry && typeof firstUserEntry === "object") {
		const text = collapseWhitespace(extractMessageText("type" in firstUserEntry && firstUserEntry.type === "message" && "message" in firstUserEntry ? firstUserEntry.message : firstUserEntry));
		if (text) return text;
	}
	return DEFAULT_PENDING_SESSION_NAME;
}
function formatFallbackTreeEntryLabel(entry) {
	if (entry.type === "message" && "message" in entry) return describeSessionEntry(entry);
	const role = typeof entry.role === "string" ? entry.role : void 0;
	if (role) {
		const content = collapseWhitespace(extractMessageText(entry));
		return content ? `${role}: ${content}` : role;
	}
	return describeSessionEntry(entry);
}
function describeSessionEntry(entry) {
	switch (entry.type) {
		case "message": return describeMessage(entry.message);
		case "custom_message": {
			const content = collapseWhitespace(Array.isArray(entry.content) ? entry.content.filter((item) => typeof item === "object" && item !== null && item.type === "text").map((item) => item.text ?? "").join(" ") : typeof entry.content === "string" ? entry.content : "");
			return content ? `[${entry.customType}]: ${content}` : `[${entry.customType}]`;
		}
		case "compaction": return `[compaction: ${Math.round(entry.tokensBefore / 1e3)}k tokens]`;
		case "branch_summary": return `[branch summary]: ${collapseWhitespace(entry.summary)}`;
		case "model_change": return `[model: ${entry.modelId}]`;
		case "thinking_level_change": return `[thinking: ${entry.thinkingLevel}]`;
		case "session_info": return entry.name ? `[title: ${entry.name}]` : "[title]";
		case "custom": return `[custom: ${entry.customType}]`;
		case "label": return entry.label ? `[label: ${entry.label}]` : "[label]";
		default: return entry.type;
	}
}
function normalizeRpcImages(images) {
	if (!Array.isArray(images)) return void 0;
	const normalized = images.flatMap((image) => {
		if (typeof image !== "object" || image === null) return [];
		const data = image.data;
		const mimeType = image.mimeType;
		if (typeof data !== "string" || typeof mimeType !== "string" || !mimeType.startsWith("image/")) return [];
		return [{
			type: "image",
			data,
			mimeType
		}];
	});
	return normalized.length > 0 ? normalized : void 0;
}
function buildUserMessageContent(message, images) {
	if (!images?.length) return message;
	const content = [];
	if (message) content.push({
		type: "text",
		text: message
	});
	content.push(...images);
	return content;
}
function queuedMessageTimestamp(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}
function extractMessageImages(message) {
	if (!Array.isArray(message.content)) return [];
	return message.content.flatMap((item) => {
		if (typeof item !== "object" || item === null) return [];
		const typedItem = item;
		if (typedItem.type !== "image" || typeof typedItem.data !== "string" || typeof typedItem.mimeType !== "string") return [];
		return [{
			type: "image",
			data: typedItem.data,
			mimeType: typedItem.mimeType
		}];
	});
}
function toRpcQueuedMessage(message, queueType) {
	return {
		text: extractMessageText(message),
		images: extractMessageImages(message),
		timestamp: queuedMessageTimestamp(message.timestamp),
		queueType
	};
}
function queuedAgentMessages(session, queueName) {
	const queue = session.agent?.[queueName];
	return Array.isArray(queue?.messages) ? queue.messages : [];
}
function trackedQueuedMessages(session, queueName) {
	const queue = session?.[queueName];
	return Array.isArray(queue) ? [...queue] : [];
}
function buildTrackedQueuedMessages(session, queueName, trackedQueueName, queueType) {
	const queued = queuedAgentMessages(session, queueName);
	const tracked = trackedQueuedMessages(session, trackedQueueName);
	const messages = tracked.map((text, index) => {
		const queuedMessage = queued[index];
		if (queuedMessage && extractMessageText(queuedMessage) === text) return toRpcQueuedMessage(queuedMessage, queueType);
		return {
			text,
			images: [],
			timestamp: Date.now(),
			queueType
		};
	});
	for (let index = tracked.length; index < queued.length; index += 1) messages.push(toRpcQueuedMessage(queued[index], queueType));
	return messages;
}
function buildQueueUpdateEvent(session, sessionPath) {
	return {
		type: "queue_update",
		sessionPath: sessionPath ?? void 0,
		steering: buildTrackedQueuedMessages(session, "steeringQueue", "_steeringMessages", "steering"),
		followUp: buildTrackedQueuedMessages(session, "followUpQueue", "_followUpMessages", "followUp")
	};
}
function clearSteeringQueue(session) {
	const followUpQueue = [...queuedAgentMessages(session, "followUpQueue")];
	const followUpMessages = trackedQueuedMessages(session, "_followUpMessages");
	const agent = session.agent;
	const sessionWithQueue = session;
	if (typeof sessionWithQueue.clearQueue === "function") {
		sessionWithQueue.clearQueue();
		const restoredFollowUpQueue = agent.followUpQueue?.messages;
		if (Array.isArray(restoredFollowUpQueue)) {
			restoredFollowUpQueue.length = 0;
			restoredFollowUpQueue.push(...followUpQueue);
		}
		if (Array.isArray(sessionWithQueue._followUpMessages)) {
			sessionWithQueue._followUpMessages.length = 0;
			sessionWithQueue._followUpMessages.push(...followUpMessages);
		}
		sessionWithQueue._emitQueueUpdate?.();
		return;
	}
	agent.clearSteeringQueue?.();
	if (Array.isArray(sessionWithQueue._steeringMessages)) sessionWithQueue._steeringMessages.length = 0;
	sessionWithQueue._emitQueueUpdate?.();
}
function dequeueFollowUpMessage(session, index) {
	if (!Number.isInteger(index) || index < 0) throw new Error("Queued message index must be a non-negative integer");
	const followUpQueue = queuedAgentMessages(session, "followUpQueue");
	if (index >= followUpQueue.length) throw new Error(`Queued message not found at index ${index}`);
	const sessionWithQueue = session;
	const trackedMessages = sessionWithQueue._followUpMessages;
	if (!Array.isArray(trackedMessages)) throw new Error("Detached follow-up queue is unavailable");
	const [removed] = followUpQueue.splice(index, 1);
	trackedMessages.splice(index, 1);
	sessionWithQueue._emitQueueUpdate?.();
	return toRpcQueuedMessage(removed, "followUp");
}
function describeMessage(message) {
	const role = message.role ?? "message";
	const content = collapseWhitespace(extractMessageText(message));
	switch (role) {
		case "user": return content ? `user: ${content}` : "user";
		case "assistant":
			if (content) return `assistant: ${content}`;
			if (message.stopReason === "aborted") return "assistant: (aborted)";
			if (message.errorMessage) return `assistant: ${collapseWhitespace(message.errorMessage)}`;
			return "assistant: (no content)";
		case "toolResult": return message.toolName ? `[tool: ${message.toolName}]` : "[tool result]";
		case "bashExecution": return message.command ? `[bash]: ${collapseWhitespace(message.command)}` : "[bash]";
		default: return content ? `${role}: ${content}` : `[${role}]`;
	}
}
function extractMessageText(message) {
	if (typeof message.content === "string") return message.content;
	if (typeof message.text === "string") return message.text;
	if (!Array.isArray(message.content)) return "";
	return message.content.map((block) => {
		if (typeof block === "string") return block;
		if (typeof block !== "object" || block === null) return "";
		const typedBlock = block;
		if (typedBlock.type === "text" || typedBlock.type === "toolResult") return typeof typedBlock.text === "string" ? typedBlock.text : "";
		if (typedBlock.type === "thinking") return typeof typedBlock.thinking === "string" ? typedBlock.thinking : "";
		return "";
	}).filter(Boolean).join(" ");
}
function collapseWhitespace(value) {
	return value.replace(/\s+/g, " ").trim();
}
var SessionRuntime = class {
	context;
	clientId;
	registry;
	createExtensionUIContext;
	onDetachedSessionEvent;
	selectedSessionPath = null;
	unsubscribeSelectedSession;
	constructor(context, clientId, registry, createExtensionUIContext, onDetachedSessionEvent) {
		this.context = context;
		this.clientId = clientId;
		this.registry = registry;
		this.createExtensionUIContext = createExtensionUIContext;
		this.onDetachedSessionEvent = onDetachedSessionEvent;
	}
	hasDetachedSelection() {
		return this.selectedSessionPath !== null;
	}
	getDetachedSession() {
		if (!this.selectedSessionPath) return null;
		return this.registry.getActiveSession(this.selectedSessionPath);
	}
	getCachedSessionManager(sessionPath) {
		return this.registry.getCachedSessionManager(sessionPath);
	}
	getCachedSessionManagers() {
		return this.registry.getCachedSessionManagers();
	}
	isSessionRunning(sessionPath) {
		const liveSessionPath = this.context.state.sessionManager.getSessionFile();
		if (liveSessionPath && sessionPath === liveSessionPath) return !this.context.state.isIdle();
		return this.registry.isSessionRunning(sessionPath);
	}
	currentDetachedSessionPath() {
		return this.selectedSessionPath;
	}
	currentTranscriptSessionPath() {
		return this.selectedSessionPath ?? this.context.state.sessionManager.getSessionFile() ?? null;
	}
	currentGitCwd() {
		if (this.selectedSessionPath) {
			const activeCwd = this.registry.getActiveSession(this.selectedSessionPath)?.sessionManager.getCwd();
			if (activeCwd) return activeCwd;
			const storedCwd = this.registry.getCachedSessionManager(this.selectedSessionPath)?.getCwd();
			if (storedCwd) return storedCwd;
		}
		return this.context.state.cwd;
	}
	shouldHandleLiveSessionEvents() {
		return !this.selectedSessionPath || this.isViewingLiveSession();
	}
	buildCurrentTranscriptMessages() {
		if (this.isViewingLiveSession()) return flattenMessagesForTranscript(this.context.state.sessionManager.getBranch());
		if (this.selectedSessionPath) return flattenMessagesForTranscript(this.registry.openSession(this.selectedSessionPath).getSessionManager().getBranch());
		return flattenMessagesForTranscript(this.context.state.sessionManager.getBranch());
	}
	buildCurrentTranscriptPage(options) {
		return buildTranscriptPage(this.buildCurrentTranscriptMessages(), this.currentTranscriptSessionPath(), options);
	}
	buildTreeEntriesForSessionPath(sessionPath) {
		const activeSession = sessionPath ? this.registry.getActiveSession(sessionPath) : null;
		if (activeSession) return buildTreeEntriesFromSession(activeSession.sessionManager);
		const liveSessionPath = this.context.state.sessionManager.getSessionFile();
		if (!sessionPath || sessionPath === liveSessionPath) return buildTreeEntriesFromSession(this.context.state.sessionManager);
		const cachedSession = this.registry.getCachedSessionManager(sessionPath);
		if (cachedSession) return buildTreeEntriesFromSession(cachedSession);
		if (fs.existsSync(sessionPath)) return buildTreeEntriesForSessionPath(sessionPath);
		return [];
	}
	buildActiveState() {
		if (this.selectedSessionPath) {
			const activeSession = this.registry.getActiveSession(this.selectedSessionPath);
			if (activeSession) {
				const workspacePath = activeSession.sessionManager.getCwd() ?? this.context.state.cwd;
				const workspaceEnvironments = detectWorkspaceEnvironments(workspacePath);
				return {
					model: activeSession.model ?? findLatestModelInfo(activeSession.sessionManager.getBranch()) ?? void 0,
					thinkingLevel: activeSession.thinkingLevel,
					isStreaming: activeSession.isStreaming,
					isCompacting: activeSession.isCompacting,
					steeringMode: activeSession.steeringMode,
					followUpMode: activeSession.followUpMode,
					sessionFile: activeSession.sessionFile,
					sessionId: activeSession.sessionId,
					sessionName: sessionDisplayName(activeSession.sessionManager, activeSession.sessionFile),
					workspacePath,
					...workspaceEnvironments ? { workspaceEnvironments } : {},
					gitBranch: getCurrentGitBranch(workspacePath),
					autoCompactionEnabled: activeSession.autoCompactionEnabled,
					messageCount: activeSession.sessionManager.getEntries()?.length ?? 0,
					pendingMessageCount: activeSession.pendingMessageCount
				};
			}
			if (!this.isViewingLiveSession()) return buildStateFromStoredSession(this.registry.openSession(this.selectedSessionPath).getSessionManager(), this.context.state.cwd);
		}
		const sessionFile = this.context.state.sessionManager.getSessionFile();
		const workspaceEnvironments = detectWorkspaceEnvironments(this.context.state.cwd);
		return {
			model: this.context.state.getCurrentModel(),
			thinkingLevel: normalizeThinkingLevel(this.context.state.getThinkingLevel()),
			isStreaming: !this.context.state.isIdle(),
			isCompacting: false,
			steeringMode: "all",
			followUpMode: "all",
			sessionFile,
			sessionId: this.context.state.sessionManager.getSessionId(),
			sessionName: sessionDisplayName({
				getSessionName: () => void 0,
				getEntries: () => this.context.state.sessionManager.getEntries() ?? [],
				getSessionId: () => this.context.state.sessionManager.getSessionId()
			}, sessionFile),
			workspacePath: normalizeOptionalWorkspaceRoot(this.context.state.cwd),
			...workspaceEnvironments ? { workspaceEnvironments } : {},
			gitBranch: getCurrentGitBranch(this.context.state.cwd),
			autoCompactionEnabled: true,
			messageCount: this.context.state.sessionManager.getEntries()?.length ?? 0,
			pendingMessageCount: this.context.state.hasPendingMessages() ? 1 : 0
		};
	}
	async createDetachedSession(options = {}) {
		const currentSessionFile = this.currentDetachedSessionPath() ?? this.context.state.sessionManager.getSessionFile();
		const currentSessionManager = this.selectedSessionPath ? this.registry.getCachedSessionManager(this.selectedSessionPath) : null;
		const targetCwd = normalizeOptionalWorkspaceRoot(options.workspacePath) || normalizeOptionalWorkspaceRoot(currentSessionManager?.getCwd()) || normalizeOptionalWorkspaceRoot(this.context.state.sessionManager.getCwd()) || normalizeOptionalWorkspaceRoot(this.context.state.cwd) || this.context.state.cwd;
		const sessionDir = options.workspacePath ? resolveWorkspaceSessionDirPath(targetCwd) : currentSessionFile ? path.dirname(currentSessionFile) : void 0;
		const handle = this.registry.createSession({
			cwd: targetCwd,
			sessionDir
		});
		await this.selectSessionPath(handle.sessionPath);
		return this.buildSessionSummary(handle.getSessionManager(), handle.sessionPath, options.transcriptLimit);
	}
	async switchToStoredSession(sessionPath, transcriptLimit) {
		const handle = this.registry.openSession(sessionPath);
		await this.selectSessionPath(sessionPath);
		return this.buildSessionSummary(handle.getSessionManager(), sessionPath, transcriptLimit);
	}
	async ensureDetachedSession(_options) {
		if (!this.selectedSessionPath) throw new Error("Selected session file not found");
		await this.registry.bindViewer(this.selectedSessionPath, {
			clientId: this.clientId,
			uiContext: this.createExtensionUIContext()
		});
		return this.registry.ensureSession(this.selectedSessionPath);
	}
	async ensureDetachedSessionFromLive(options) {
		const liveSessionPath = this.context.state.sessionManager.getSessionFile();
		if (!liveSessionPath || !fs.existsSync(liveSessionPath)) throw new Error("No session file available");
		await this.selectSessionPath(liveSessionPath);
		return this.ensureDetachedSession(options);
	}
	clearSelection() {
		if (this.unsubscribeSelectedSession) {
			this.unsubscribeSelectedSession();
			this.unsubscribeSelectedSession = void 0;
		}
		const selectedSessionPath = this.selectedSessionPath;
		this.selectedSessionPath = null;
		if (selectedSessionPath) this.registry.releaseViewer(selectedSessionPath, this.clientId);
	}
	dispose() {
		this.clearSelection();
	}
	buildSessionSummary(sessionManager, sessionPath, transcriptLimit) {
		return {
			sessionManager,
			sessionPath,
			transcript: buildTranscriptPage(flattenMessagesForTranscript(sessionManager.getBranch()), sessionPath, { limit: transcriptLimit }),
			treeEntries: buildTreeEntriesFromSession(sessionManager),
			sessionId: sessionManager.getSessionId(),
			sessionName: sessionDisplayName(sessionManager, sessionPath),
			workspacePath: normalizeOptionalWorkspaceRoot(sessionManager.getCwd())
		};
	}
	isViewingLiveSession() {
		const liveSessionPath = this.context.state.sessionManager.getSessionFile();
		return Boolean(this.selectedSessionPath && liveSessionPath && this.selectedSessionPath === liveSessionPath && !this.registry.isSessionActive(this.selectedSessionPath));
	}
	async selectSessionPath(sessionPath) {
		if (this.selectedSessionPath === sessionPath) {
			await this.registry.bindViewer(sessionPath, {
				clientId: this.clientId,
				uiContext: this.createExtensionUIContext()
			});
			if (!this.unsubscribeSelectedSession) this.unsubscribeSelectedSession = this.registry.openSession(sessionPath).subscribe((event) => {
				this.onDetachedSessionEvent(event);
			});
			return;
		}
		if (this.unsubscribeSelectedSession) {
			this.unsubscribeSelectedSession();
			this.unsubscribeSelectedSession = void 0;
		}
		if (this.selectedSessionPath) this.registry.releaseViewer(this.selectedSessionPath, this.clientId);
		this.selectedSessionPath = sessionPath;
		this.unsubscribeSelectedSession = this.registry.openSession(sessionPath).subscribe((event) => {
			this.onDetachedSessionEvent(event);
		});
		await this.registry.bindViewer(sessionPath, {
			clientId: this.clientId,
			uiContext: this.createExtensionUIContext()
		});
	}
};
var TranscriptProjector = class {
	state = {
		sessionPath: null,
		nextEphemeralId: 0,
		messageIdToKey: /* @__PURE__ */ new Map(),
		openKeysByRole: /* @__PURE__ */ new Map(),
		lastMessagesByKey: /* @__PURE__ */ new Map(),
		closedKeys: /* @__PURE__ */ new Set()
	};
	syncPage(page) {
		const previousClosedKeys = this.state.closedKeys;
		this.state = {
			sessionPath: page.sessionPath ?? null,
			nextEphemeralId: 0,
			messageIdToKey: /* @__PURE__ */ new Map(),
			openKeysByRole: /* @__PURE__ */ new Map(),
			lastMessagesByKey: /* @__PURE__ */ new Map(),
			closedKeys: /* @__PURE__ */ new Set()
		};
		for (const message of page.messages) {
			const key = message.transcriptKey ?? message.id;
			if (!key) continue;
			if (message.id) this.state.messageIdToKey.set(message.id, key);
			if (previousClosedKeys.has(key)) this.state.closedKeys.add(key);
			this.state.lastMessagesByKey.set(key, message);
		}
	}
	buildSnapshotEvent(page) {
		this.syncPage(page);
		return {
			type: "transcript_snapshot",
			...page
		};
	}
	projectLifecycleEvent(eventType, event, sessionPath) {
		const message = extractEventMessage(event);
		if (!message) return null;
		if (this.state.sessionPath !== sessionPath) this.syncPage({
			messages: [],
			sessionPath
		});
		const transcriptKey = this.resolveTranscriptKey(eventType, message);
		if (!transcriptKey) return null;
		const transcriptMessage = this.toTranscriptMessage(message, transcriptKey);
		if (!transcriptMessage) return null;
		const payloadMessage = eventType === "message_start" ? streamStartMessage(transcriptMessage) : transcriptMessage;
		this.rememberTranscriptMessage(payloadMessage);
		return {
			type: eventType === "message_start" ? "transcript_start" : "transcript_upsert",
			sessionPath: sessionPath ?? void 0,
			message: payloadMessage
		};
	}
	projectDeltaEvent(event, sessionPath) {
		const message = extractEventMessage(event);
		if (!message) return null;
		if (this.state.sessionPath !== sessionPath) this.syncPage({
			messages: [],
			sessionPath
		});
		const transcriptKey = this.resolveTranscriptKey("message_update", message);
		if (!transcriptKey) return null;
		if (this.state.closedKeys.has(transcriptKey)) return null;
		const role = typeof message.role === "string" ? message.role : null;
		if (!role) return null;
		const transcriptMessage = this.toTranscriptMessage(message, transcriptKey);
		if (!transcriptMessage) return null;
		const deltaEvent = extractAssistantMessageDeltaEvent(event, transcriptMessage) ?? synthesizeTranscriptDelta(this.state.lastMessagesByKey.get(transcriptKey), transcriptMessage);
		this.rememberTranscriptMessage(transcriptMessage);
		if (!deltaEvent) return null;
		return {
			type: "transcript_delta",
			sessionPath: sessionPath ?? void 0,
			transcriptKey,
			messageId: typeof message.id === "string" ? message.id : void 0,
			role,
			...deltaEvent
		};
	}
	rememberTranscriptMessage(message) {
		const key = message.transcriptKey ?? message.id;
		if (!key) return;
		this.state.lastMessagesByKey.set(key, message);
		if (message.id) this.state.messageIdToKey.set(message.id, key);
	}
	nextTranscriptKey() {
		this.state.nextEphemeralId += 1;
		return `live:${this.state.nextEphemeralId}`;
	}
	roleOpenKeys(role) {
		const existing = this.state.openKeysByRole.get(role);
		if (existing) return existing;
		const created = [];
		this.state.openKeysByRole.set(role, created);
		return created;
	}
	markRoleKeyOpen(role, key) {
		this.state.closedKeys.delete(key);
		const keys = this.roleOpenKeys(role);
		if (!keys.includes(key)) keys.push(key);
	}
	markRoleKeyClosed(role, key) {
		this.state.closedKeys.add(key);
		const keys = this.state.openKeysByRole.get(role);
		if (!keys) return;
		const next = keys.filter((candidate) => candidate !== key);
		if (next.length > 0) {
			this.state.openKeysByRole.set(role, next);
			return;
		}
		this.state.openKeysByRole.delete(role);
	}
	findOpenRoleKey(role) {
		const keys = this.state.openKeysByRole.get(role);
		if (!keys || keys.length === 0) return null;
		return keys[keys.length - 1] ?? null;
	}
	resolveTranscriptKey(eventType, message) {
		const role = typeof message.role === "string" ? message.role : null;
		if (!role) return null;
		const messageId = typeof message.id === "string" ? message.id : null;
		if (eventType === "message_start") {
			const key = (messageId && this.state.messageIdToKey.get(messageId)) ?? this.nextTranscriptKey();
			if (messageId) this.state.messageIdToKey.set(messageId, key);
			this.markRoleKeyOpen(role, key);
			return key;
		}
		const knownKey = (messageId && this.state.messageIdToKey.get(messageId)) ?? this.findOpenRoleKey(role);
		const key = knownKey ?? this.nextTranscriptKey();
		if (messageId) this.state.messageIdToKey.set(messageId, key);
		if (!knownKey) this.markRoleKeyOpen(role, key);
		if (eventType === "message_end") this.markRoleKeyClosed(role, key);
		return key;
	}
	toTranscriptMessage(message, transcriptKey) {
		const role = typeof message.role === "string" ? message.role : null;
		if (!role) return null;
		return {
			transcriptKey,
			...message,
			id: typeof message.id === "string" ? message.id : void 0,
			role,
			timestamp: typeof message.timestamp === "string" ? message.timestamp : void 0
		};
	}
};
const TRANSCRIPT_DELTA_BATCH_MS = 200;
const TRANSCRIPT_DELTA_MAX_CHARS = 32;
var ExtensionUIBridge = class {
	clientId;
	config;
	send;
	pendingRequests = /* @__PURE__ */ new Map();
	constructor(clientId, config, send) {
		this.clientId = clientId;
		this.config = config;
		this.send = send;
	}
	handleResponse(response) {
		const pending = this.pendingRequests.get(response.id);
		if (!pending) {
			console.warn(`WsRpcAdapter[${this.clientId}]: Received UI response for unknown request: ${response.id}`);
			return;
		}
		if (pending.timeoutId) clearTimeout(pending.timeoutId);
		this.pendingRequests.delete(response.id);
		console.log(`WsRpcAdapter[${this.clientId}]: UI request ${response.id} (${pending.method}) resolved`);
		pending.resolve(response);
	}
	createContext() {
		const createDialogPromise = (request, defaultValue, parseResponse) => {
			const id = crypto.randomUUID();
			return new Promise((resolve, reject) => {
				let timeoutId;
				const cleanup = () => {
					if (timeoutId) clearTimeout(timeoutId);
					this.pendingRequests.delete(id);
				};
				timeoutId = setTimeout(() => {
					console.log(`WsRpcAdapter[${this.clientId}]: UI request ${id} (${request.method}) timed out`);
					cleanup();
					resolve(defaultValue);
				}, this.config.uiRequestTimeout);
				this.pendingRequests.set(id, {
					resolve: (value) => {
						cleanup();
						resolve(parseResponse(value));
					},
					reject,
					timeoutId,
					method: request.method
				});
				this.sendRequest({
					type: "extension_ui_request",
					id,
					...request
				});
			});
		};
		const setEditorText = (text) => {
			this.sendRequest({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "set_editor_text",
				text
			});
		};
		return {
			select: (title, options, opts) => createDialogPromise({
				method: "select",
				title,
				options,
				timeout: opts?.timeout
			}, void 0, (r) => "cancelled" in r && r.cancelled ? void 0 : "value" in r ? r.value : void 0),
			confirm: (title, message, opts) => createDialogPromise({
				method: "confirm",
				title,
				message,
				timeout: opts?.timeout
			}, false, (r) => "cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false),
			input: (title, placeholder, opts) => createDialogPromise({
				method: "input",
				title,
				placeholder,
				timeout: opts?.timeout
			}, void 0, (r) => "cancelled" in r && r.cancelled ? void 0 : "value" in r ? r.value : void 0),
			editor: (title, prefill) => createDialogPromise({
				method: "editor",
				title,
				prefill
			}, void 0, (r) => "cancelled" in r && r.cancelled ? void 0 : "value" in r ? r.value : void 0),
			notify: (message, notifyType) => {
				this.sendRequest({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "notify",
					message,
					notifyType
				});
			},
			setStatus: (key, statusText) => {
				this.sendRequest({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setStatus",
					statusKey: key,
					statusText
				});
			},
			setWidget: (key, content, options) => {
				if (typeof content === "function") return;
				this.sendRequest({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWidget",
					widgetKey: key,
					widgetLines: content,
					widgetPlacement: options?.placement
				});
			},
			setTitle: (title) => {
				this.sendRequest({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setTitle",
					title
				});
			},
			setEditorText,
			getEditorText: () => "",
			onTerminalInput: () => () => {},
			setWorkingMessage: () => {},
			setHiddenThinkingLabel: () => {},
			setFooter: () => {},
			setHeader: () => {},
			custom: async () => void 0,
			pasteToEditor: (text) => {
				setEditorText(text);
			},
			setEditorComponent: () => {},
			theme: {},
			getAllThemes: () => [],
			getTheme: () => void 0,
			setTheme: () => ({
				success: false,
				error: "Not supported"
			}),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
			setWorkingVisible: () => {},
			setWorkingIndicator: () => {},
			addAutocompleteProvider: () => {},
			getEditorComponent: () => void 0
		};
	}
	dispose() {
		for (const [id, pending] of this.pendingRequests) {
			if (pending.timeoutId) clearTimeout(pending.timeoutId);
			console.log(`WsRpcAdapter[${this.clientId}]: Resolving UI request ${id} (${pending.method}) on disconnect`);
			pending.resolve({
				type: "extension_ui_response",
				id,
				cancelled: true
			});
		}
		this.pendingRequests.clear();
	}
	sendRequest(request) {
		console.log(`WsRpcAdapter[${this.clientId}]: Sending UI request ${request.id} (${request.method})`);
		this.send({
			type: "extension_ui_request",
			payload: request
		});
	}
};
var SessionStatsPusher = class {
	buildStats;
	send;
	inFlight = false;
	pendingPath = void 0;
	disposed = false;
	constructor(buildStats, send) {
		this.buildStats = buildStats;
		this.send = send;
	}
	queue(sessionPath) {
		this.pendingPath = sessionPath;
		if (this.inFlight || this.disposed) return;
		this.flush();
	}
	dispose() {
		this.disposed = true;
		this.pendingPath = void 0;
	}
	async flush() {
		const sessionPath = this.pendingPath;
		if (sessionPath === void 0 || this.disposed) return;
		this.pendingPath = void 0;
		this.inFlight = true;
		try {
			const stats = await this.buildStats(sessionPath);
			if (this.disposed) return;
			this.send({
				type: "session_stats",
				sessionPath: sessionPath ?? void 0,
				stats
			});
		} catch {} finally {
			this.inFlight = false;
			if (this.pendingPath !== void 0 && !this.disposed) this.flush();
		}
	}
};
var WsRpcAdapter = class {
	client;
	ws;
	context;
	config;
	eventBus;
	emitEvent;
	sessionRuntime;
	transcriptProjector = new TranscriptProjector();
	uiBridge;
	sessionStatsPusher;
	detachedSessionRegistry;
	pendingTranscriptDeltaBatch = null;
	unsubscribeRegistryEvents;
	disposed = false;
	workspaceEntriesCache = null;
	constructor(client, ws, context, config, eventBus, emitEvent, sessionRegistry) {
		this.client = client;
		this.ws = ws;
		this.context = context;
		this.config = config;
		this.eventBus = eventBus;
		this.emitEvent = emitEvent;
		this.detachedSessionRegistry = sessionRegistry ?? new DetachedSessionRegistry(context.state.cwd);
		this.uiBridge = new ExtensionUIBridge(client.id, config, (message) => {
			this.sendResponse(message);
		});
		this.sessionRuntime = new SessionRuntime(context, client.id, this.detachedSessionRegistry, () => this.uiBridge.createContext(), (event) => {
			this.handleSelectedSessionEvent(event);
		});
		this.sessionStatsPusher = new SessionStatsPusher((sessionPath) => this.buildSessionStats(sessionPath), (payload) => {
			this.sendEvent(payload);
		});
		this.setupWebSocket();
		this.subscribeToEvents();
		this.subscribeToDetachedSessionEvents(this.detachedSessionRegistry);
		this.sendInitialTranscriptSnapshot();
		this.sessionStatsPusher.queue(this.sessionRuntime.currentTranscriptSessionPath());
	}
	setupWebSocket() {
		this.ws.on("message", (data) => {
			if (this.disposed) return;
			this.handleMessage(data.toString());
		});
		this.ws.on("close", () => {
			this.dispose();
		});
		this.ws.on("error", (err) => {
			console.error(`WsRpcAdapter[${this.client.id}]: WebSocket error:`, err);
			this.emitEvent({
				type: "command_error",
				client: this.client,
				commandType: "websocket",
				error: err.message
			});
		});
	}
	/**
	* Subscribe to Pi events and route them directly to the active browser view.
	*/
	subscribeToEvents() {
		this.eventBus;
		this.context.events.subscribe((event) => {
			switch (event.type) {
				case "agent_start":
					this.sendEvent(toRpcAgentStartEvent(this.context.state.sessionManager.getSessionFile()));
					return;
				case "agent_end": {
					const liveSessionPath = this.context.state.sessionManager.getSessionFile();
					this.sendEvent(toRpcAgentEndEvent(event, liveSessionPath));
					if (!this.sessionRuntime.shouldHandleLiveSessionEvents()) return;
					this.sessionStatsPusher.queue(this.sessionRuntime.currentTranscriptSessionPath());
					return;
				}
				case "session_compact":
					if (!this.sessionRuntime.shouldHandleLiveSessionEvents()) return;
					this.sendTranscriptSnapshot(this.sessionRuntime.buildCurrentTranscriptPage());
					this.sessionStatsPusher.queue(this.sessionRuntime.currentTranscriptSessionPath());
					return;
				case "message_start":
				case "message_update":
				case "message_end":
					if (!this.sessionRuntime.shouldHandleLiveSessionEvents()) return;
					this.handleTranscriptLifecycleEvent(event.type, event, this.sessionRuntime.currentTranscriptSessionPath());
					return;
				case "model_select":
					if (!this.sessionRuntime.shouldHandleLiveSessionEvents()) return;
					this.sendEvent(toRpcModelSelectEvent(event));
					this.sessionStatsPusher.queue(this.sessionRuntime.currentTranscriptSessionPath());
					return;
			}
		});
	}
	subscribeToDetachedSessionEvents(sessionRegistry) {
		if (!sessionRegistry) return;
		this.unsubscribeRegistryEvents = sessionRegistry.subscribe(({ sessionPath, event }) => {
			if (this.disposed) return;
			switch (event.type) {
				case "agent_start":
					this.sendEvent(toRpcAgentStartEvent(sessionPath));
					return;
				case "agent_end":
					this.sendEvent(toRpcAgentEndEvent(event, sessionPath));
					if (this.sessionRuntime.currentDetachedSessionPath() === sessionPath) this.sessionStatsPusher.queue(sessionPath);
					return;
				default: return;
			}
		});
	}
	sendEvent(payload) {
		if (payload.type === "transcript_delta") {
			this.queueTranscriptDelta(payload);
			return;
		}
		this.flushPendingTranscriptDeltaBatch();
		this.sendEventNow(payload);
	}
	sendEventNow(payload) {
		this.sendResponse({
			type: "event",
			payload
		});
	}
	queueTranscriptDelta(payload) {
		const pending = this.pendingTranscriptDeltaBatch;
		if (pending && this.canBatchTranscriptDelta(pending.payload, payload)) {
			pending.payload = {
				...pending.payload,
				delta: `${pending.payload.delta}${payload.delta}`,
				toolCallId: pending.payload.toolCallId ?? payload.toolCallId,
				toolName: pending.payload.toolName ?? payload.toolName
			};
			if (this.shouldFlushTranscriptDeltaBatch(pending.payload)) this.flushPendingTranscriptDeltaBatch();
			return;
		}
		this.flushPendingTranscriptDeltaBatch();
		const timeoutId = setTimeout(() => {
			const current = this.pendingTranscriptDeltaBatch;
			if (!current || current.timeoutId !== timeoutId) return;
			this.pendingTranscriptDeltaBatch = null;
			this.sendEventNow(current.payload);
		}, TRANSCRIPT_DELTA_BATCH_MS);
		this.pendingTranscriptDeltaBatch = {
			payload,
			timeoutId
		};
		if (this.shouldFlushTranscriptDeltaBatch(payload)) this.flushPendingTranscriptDeltaBatch();
	}
	shouldFlushTranscriptDeltaBatch(payload) {
		return payload.delta.length >= TRANSCRIPT_DELTA_MAX_CHARS || payload.delta.includes("\n") || /[.!?。！？]\s*$/.test(payload.delta);
	}
	flushPendingTranscriptDeltaBatch() {
		const pending = this.pendingTranscriptDeltaBatch;
		if (!pending) return;
		this.pendingTranscriptDeltaBatch = null;
		clearTimeout(pending.timeoutId);
		this.sendEventNow(pending.payload);
	}
	canBatchTranscriptDelta(left, right) {
		return (left.sessionPath ?? null) === (right.sessionPath ?? null) && left.transcriptKey === right.transcriptKey && left.role === right.role && left.blockType === right.blockType && left.contentIndex === right.contentIndex && (left.messageId ?? null) === (right.messageId ?? null);
	}
	sendTranscriptSnapshot(page) {
		this.sendEvent(this.transcriptProjector.buildSnapshotEvent(page));
	}
	sendInitialTranscriptSnapshot() {
		this.sendTranscriptSnapshot(this.sessionRuntime.buildCurrentTranscriptPage());
	}
	handleTranscriptLifecycleEvent(eventType, event, sessionPath) {
		if (eventType === "message_update") {
			const deltaPayload = this.transcriptProjector.projectDeltaEvent(event, sessionPath);
			if (deltaPayload) {
				this.sendEvent(deltaPayload);
				return;
			}
			return;
		}
		const payload = this.transcriptProjector.projectLifecycleEvent(eventType, event, sessionPath);
		if (!payload) return;
		let treeEntries = this.sessionRuntime.buildTreeEntriesForSessionPath(sessionPath);
		if (!treeEntries.some((entry) => entry.id === payload.message.id || entry.id === payload.message.transcriptKey)) treeEntries = projectTreeEntriesWithTranscriptMessage(treeEntries, payload.message);
		payload.treeEntries = treeEntries;
		this.sendEvent(payload);
		if (eventType !== "message_start") this.sessionStatsPusher.queue(sessionPath);
	}
	sendSelectedSessionQueueUpdate() {
		const sessionPath = this.sessionRuntime.currentTranscriptSessionPath();
		const detachedSession = this.sessionRuntime.getDetachedSession();
		if (!detachedSession) return;
		this.sendEvent(buildQueueUpdateEvent(detachedSession, sessionPath));
	}
	handleSelectedSessionEvent(event) {
		const sessionPath = this.sessionRuntime.currentTranscriptSessionPath();
		const detachedSession = this.sessionRuntime.getDetachedSession();
		const eventType = event.type;
		if (eventType === "session_compact") {
			this.sendTranscriptSnapshot(this.sessionRuntime.buildCurrentTranscriptPage());
			this.sessionStatsPusher.queue(sessionPath);
			return;
		}
		if (eventType === "model_select") {
			if (!isPiModelSelectEventLike(event)) return;
			this.sendEvent(toRpcModelSelectEvent(event));
			this.sessionStatsPusher.queue(sessionPath);
			return;
		}
		switch (event.type) {
			case "message_start":
			case "message_update":
			case "message_end":
				this.handleTranscriptLifecycleEvent(event.type, event, sessionPath);
				return;
			case "agent_start": return;
			case "agent_end":
				if (detachedSession) this.sendTranscriptSnapshot(buildTranscriptPage(flattenMessagesForTranscript(detachedSession.sessionManager.getBranch()), detachedSession.sessionFile ?? null));
				this.sessionStatsPusher.queue(sessionPath);
				return;
			case "queue_update":
				if (detachedSession) this.sendEvent(buildQueueUpdateEvent(detachedSession, sessionPath));
				return;
			case "compaction_start":
				this.sendEvent(toRpcCompactionStartEvent(event));
				return;
			case "compaction_end":
				this.sendTranscriptSnapshot(this.sessionRuntime.buildCurrentTranscriptPage());
				this.sendEvent(toRpcCompactionEndEvent(event));
				this.sessionStatsPusher.queue(sessionPath);
				return;
			default: return;
		}
	}
	toRpcSessionStats(stats) {
		return {
			tokens: stats.contextUsage?.tokens ?? null,
			contextWindow: stats.contextUsage?.contextWindow ?? 0,
			percent: stats.contextUsage?.percent ?? null,
			messageCount: stats.totalMessages,
			cost: stats.cost,
			inputTokens: stats.tokens.input,
			outputTokens: stats.tokens.output,
			cacheReadTokens: stats.tokens.cacheRead,
			cacheWriteTokens: stats.tokens.cacheWrite
		};
	}
	async lookupContextWindow(provider, modelId) {
		if (!provider || !modelId) return 0;
		try {
			return this.context.state.getAvailableModels().find((model) => model.provider === provider && model.id === modelId)?.contextWindow ?? 0;
		} catch {
			return 0;
		}
	}
	async buildSessionStats(targetPath) {
		const selectedSessionPath = this.sessionRuntime.currentDetachedSessionPath();
		const detachedSession = this.sessionRuntime.getDetachedSession();
		const liveSessionPath = this.context.state.sessionManager.getSessionFile();
		const resolvedTargetPath = targetPath === void 0 ? selectedSessionPath ?? liveSessionPath ?? null : targetPath;
		const cachedSessionManager = resolvedTargetPath ? this.sessionRuntime.getCachedSessionManager(resolvedTargetPath) : null;
		if (detachedSession && (!resolvedTargetPath || resolvedTargetPath === detachedSession.sessionFile || resolvedTargetPath === selectedSessionPath)) return this.toRpcSessionStats(detachedSession.getSessionStats());
		if (resolvedTargetPath && resolvedTargetPath !== liveSessionPath) try {
			const storedSessionManager = cachedSessionManager ? cachedSessionManager : fs.existsSync(resolvedTargetPath) ? openSessionManager(resolvedTargetPath) : null;
			if (storedSessionManager) {
				const summary = summarizeTokenUsage(storedSessionManager.getBranch(), storedSessionManager.getEntries());
				let tokens = null;
				let contextWindow = 0;
				let percent = null;
				if (summary.lastAssistantUsage) {
					const usage = summary.lastAssistantUsage;
					tokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
				}
				if (tokens != null) {
					contextWindow = await this.lookupContextWindow(summary.lastModel?.provider, summary.lastModel?.modelId);
					if (contextWindow > 0) percent = Math.round(tokens / contextWindow * 100 * 10) / 10;
				}
				return {
					tokens,
					contextWindow,
					percent,
					messageCount: summary.messageCount,
					cost: summary.totalCost,
					inputTokens: summary.inputTokens,
					outputTokens: summary.outputTokens,
					cacheReadTokens: summary.cacheReadTokens,
					cacheWriteTokens: summary.cacheWriteTokens
				};
			}
		} catch {}
		const usage = this.context.state.getContextUsage();
		const summary = summarizeTokenUsage(this.context.state.sessionManager.getBranch(), this.context.state.sessionManager.getEntries());
		let tokens = usage?.tokens ?? null;
		let contextWindow = usage?.contextWindow ?? 0;
		let percent = usage?.percent ?? null;
		if (tokens == null && summary.lastAssistantUsage) tokens = (summary.lastAssistantUsage.input ?? 0) + (summary.lastAssistantUsage.cacheRead ?? 0) + (summary.lastAssistantUsage.cacheWrite ?? 0);
		if (contextWindow === 0 && tokens != null) contextWindow = await this.lookupContextWindow(summary.lastModel?.provider, summary.lastModel?.modelId);
		if (percent == null && tokens != null && contextWindow > 0) percent = Math.round(tokens / contextWindow * 100 * 10) / 10;
		return {
			tokens,
			contextWindow,
			percent,
			messageCount: summary.messageCount,
			cost: summary.totalCost,
			inputTokens: summary.inputTokens,
			outputTokens: summary.outputTokens,
			cacheReadTokens: summary.cacheReadTokens,
			cacheWriteTokens: summary.cacheWriteTokens
		};
	}
	buildSelectTreeEntryResponse(correlationId, sessionManager, sessionPath, targetEntryId) {
		const transcript = buildTranscriptPage(buildExactSelectionTranscriptMessages(sessionManager.getBranch(), targetEntryId), sessionPath);
		this.transcriptProjector.syncPage(transcript);
		return {
			id: correlationId,
			type: "response",
			command: "select_tree_entry",
			success: true,
			data: {
				transcript,
				treeEntries: buildTreeEntriesFromSession(sessionManager),
				sessionId: sessionManager.getSessionId(),
				sessionName: sessionDisplayName(sessionManager, sessionPath),
				sessionPath,
				workspacePath: normalizeOptionalWorkspaceRoot(sessionManager.getCwd()),
				cancelled: false
			}
		};
	}
	handleMessage(data) {
		let message;
		try {
			message = JSON.parse(data);
		} catch (err) {
			this.sendResponse({
				type: "response",
				payload: {
					type: "response",
					command: "parse",
					success: false,
					error: `Failed to parse message: ${err instanceof Error ? err.message : String(err)}`
				}
			});
			return;
		}
		if (message.type === "command") this.handleCommand(message.payload);
		else if (message.type === "extension_ui_response") this.handleUIResponse(message.payload);
		else this.sendResponse({
			type: "response",
			payload: {
				type: "response",
				command: "unknown",
				success: false,
				error: `Unknown message type`
			}
		});
	}
	/**
	* Handle RPC command dispatch
	*/
	async handleCommand(command) {
		const correlationId = command.id ?? crypto.randomUUID();
		this.emitEvent({
			type: "command_received",
			client: this.client,
			commandType: command.type,
			correlationId
		});
		try {
			const response = await this.dispatchCommand(command, correlationId);
			this.sendResponse({
				type: "response",
				payload: response
			});
			if (response.success && (command.type === "get_state" || command.type === "switch_session" || command.type === "new_session" || command.type === "select_tree_entry")) {
				this.sessionStatsPusher.queue(this.sessionRuntime.currentTranscriptSessionPath());
				this.sendSelectedSessionQueueUpdate();
			}
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			console.error(`WsRpcAdapter[${this.client.id}]: Command error (${command.type}):`, error);
			this.emitEvent({
				type: "command_error",
				client: this.client,
				commandType: command.type,
				correlationId,
				error
			});
			this.sendResponse({
				type: "response",
				payload: {
					id: correlationId,
					type: "response",
					command: command.type,
					success: false,
					error
				}
			});
		}
	}
	/**
	* Dispatch command to Pi extension API
	*/
	async dispatchCommand(command, correlationId) {
		switch (command.type) {
			case "prompt": {
				const images = normalizeRpcImages(command.images);
				let autoCreated = null;
				if (!this.sessionRuntime.hasDetachedSelection()) autoCreated = await this.sessionRuntime.createDetachedSession();
				const session = await this.sessionRuntime.ensureDetachedSession();
				const promptOptions = session.isStreaming ? {
					source: "rpc",
					images,
					streamingBehavior: command.streamingBehavior ?? "steer"
				} : {
					source: "rpc",
					images
				};
				setTimeout(() => {
					session.prompt(command.message, promptOptions).catch((error) => {
						const message = error instanceof Error ? error.message : String(error);
						console.error(`WsRpcAdapter[${this.client.id}]: Detached prompt failed:`, message);
						this.emitEvent({
							type: "command_error",
							client: this.client,
							commandType: "prompt",
							correlationId,
							error: message
						});
					});
				}, 0);
				if (autoCreated) {
					this.transcriptProjector.syncPage(autoCreated.transcript);
					return {
						id: correlationId,
						type: "response",
						command: "new_session",
						success: true,
						data: {
							transcript: autoCreated.transcript,
							treeEntries: autoCreated.treeEntries,
							sessionId: autoCreated.sessionId,
							sessionName: autoCreated.sessionName,
							sessionPath: autoCreated.sessionPath,
							cancelled: false
						}
					};
				}
				return {
					id: correlationId,
					type: "response",
					command: "prompt",
					success: true
				};
			}
			case "steer": {
				const images = normalizeRpcImages(command.images);
				if (this.sessionRuntime.hasDetachedSelection()) (await this.sessionRuntime.ensureDetachedSession()).steer(command.message, images).catch((error) => {
					console.error(`WsRpcAdapter[${this.client.id}]: Detached steer failed:`, error);
				});
				else this.context.actions.sendUserMessage(buildUserMessageContent(command.message, images), { deliverAs: "steer" });
				return {
					id: correlationId,
					type: "response",
					command: "steer",
					success: true
				};
			}
			case "follow_up": {
				const images = normalizeRpcImages(command.images);
				if (this.sessionRuntime.hasDetachedSelection()) (await this.sessionRuntime.ensureDetachedSession()).followUp(command.message, images).catch((error) => {
					console.error(`WsRpcAdapter[${this.client.id}]: Detached follow_up failed:`, error);
				});
				else this.context.actions.sendUserMessage(buildUserMessageContent(command.message, images), { deliverAs: "followUp" });
				return {
					id: correlationId,
					type: "response",
					command: "follow_up",
					success: true
				};
			}
			case "abort":
				if (this.sessionRuntime.hasDetachedSelection()) {
					const session = await this.sessionRuntime.ensureDetachedSession();
					clearSteeringQueue(session);
					await session.abort();
				} else this.context.actions.abort();
				return {
					id: correlationId,
					type: "response",
					command: "abort",
					success: true
				};
			case "get_state": return {
				id: correlationId,
				type: "response",
				command: "get_state",
				success: true,
				data: this.sessionRuntime.buildActiveState()
			};
			case "set_model": {
				const detachedSession = this.sessionRuntime.getDetachedSession();
				const model = (detachedSession ? detachedSession.modelRegistry.getAvailable() : this.context.state.getAvailableModels()).find((m) => m.provider === command.provider && m.id === command.modelId);
				if (!model) return {
					id: correlationId,
					type: "response",
					command: "set_model",
					success: false,
					error: `Model not found: ${command.provider}/${command.modelId}`
				};
				if (this.sessionRuntime.hasDetachedSelection()) await (await this.sessionRuntime.ensureDetachedSession()).setModel(model);
				else await this.context.actions.setModel(model);
				return {
					id: correlationId,
					type: "response",
					command: "set_model",
					success: true,
					data: model
				};
			}
			case "get_available_models": {
				const detachedSession = this.sessionRuntime.getDetachedSession();
				return {
					id: correlationId,
					type: "response",
					command: "get_available_models",
					success: true,
					data: { models: detachedSession ? detachedSession.modelRegistry.getAvailable() : this.context.state.getAvailableModels() }
				};
			}
			case "cycle_model": return {
				id: correlationId,
				type: "response",
				command: "cycle_model",
				success: false,
				error: "cycle_model not supported via bridge"
			};
			case "set_thinking_level":
				if (this.sessionRuntime.hasDetachedSelection()) (await this.sessionRuntime.ensureDetachedSession()).setThinkingLevel(command.level);
				else this.context.actions.setThinkingLevel(command.level);
				return {
					id: correlationId,
					type: "response",
					command: "set_thinking_level",
					success: true
				};
			case "cycle_thinking_level": return {
				id: correlationId,
				type: "response",
				command: "cycle_thinking_level",
				success: false,
				error: "cycle_thinking_level not supported via bridge"
			};
			case "set_steering_mode":
				if (this.sessionRuntime.hasDetachedSelection()) {
					(await this.sessionRuntime.ensureDetachedSession()).setSteeringMode(command.mode);
					return {
						id: correlationId,
						type: "response",
						command: "set_steering_mode",
						success: true
					};
				}
				return {
					id: correlationId,
					type: "response",
					command: "set_steering_mode",
					success: false,
					error: "set_steering_mode not supported via bridge"
				};
			case "set_follow_up_mode":
				if (this.sessionRuntime.hasDetachedSelection()) {
					(await this.sessionRuntime.ensureDetachedSession()).setFollowUpMode(command.mode);
					return {
						id: correlationId,
						type: "response",
						command: "set_follow_up_mode",
						success: true
					};
				}
				return {
					id: correlationId,
					type: "response",
					command: "set_follow_up_mode",
					success: false,
					error: "set_follow_up_mode not supported via bridge"
				};
			case "dequeue_follow_up_message": {
				if (!this.sessionRuntime.hasDetachedSelection()) return {
					id: correlationId,
					type: "response",
					command: "dequeue_follow_up_message",
					success: false,
					error: "Queued follow-up editing requires an active detached session"
				};
				const session = await this.sessionRuntime.ensureDetachedSession();
				try {
					return {
						id: correlationId,
						type: "response",
						command: "dequeue_follow_up_message",
						success: true,
						data: { removed: dequeueFollowUpMessage(session, command.index) }
					};
				} catch (error) {
					return {
						id: correlationId,
						type: "response",
						command: "dequeue_follow_up_message",
						success: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
			}
			case "compact":
				if (this.sessionRuntime.hasDetachedSelection()) try {
					return {
						id: correlationId,
						type: "response",
						command: "compact",
						success: true,
						data: await (await this.sessionRuntime.ensureDetachedSession()).compact(command.customInstructions)
					};
				} catch (error) {
					return {
						id: correlationId,
						type: "response",
						command: "compact",
						success: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
				return {
					id: correlationId,
					type: "response",
					command: "compact",
					success: false,
					error: "Compaction requires an active session"
				};
			case "set_auto_compaction":
				if (this.sessionRuntime.hasDetachedSelection()) {
					(await this.sessionRuntime.ensureDetachedSession()).setAutoCompactionEnabled(command.enabled);
					return {
						id: correlationId,
						type: "response",
						command: "set_auto_compaction",
						success: true
					};
				}
				return {
					id: correlationId,
					type: "response",
					command: "set_auto_compaction",
					success: false,
					error: "set_auto_compaction not supported via bridge"
				};
			case "set_auto_retry":
			case "abort_retry":
				if (this.sessionRuntime.hasDetachedSelection()) {
					const session = await this.sessionRuntime.ensureDetachedSession();
					if (command.type === "set_auto_retry") session.setAutoRetryEnabled(command.enabled);
					else session.abortRetry();
					return {
						id: correlationId,
						type: "response",
						command: command.type,
						success: true
					};
				}
				return {
					id: correlationId,
					type: "response",
					command: command.type,
					success: false,
					error: `${command.type} not supported via bridge`
				};
			case "bash":
			case "abort_bash": return {
				id: correlationId,
				type: "response",
				command: command.type,
				success: false,
				error: `${command.type} not supported via bridge for security`
			};
			case "new_session": {
				const workspacePath = normalizeOptionalWorkspaceRoot(command.workspacePath);
				if (workspacePath) {
					try {
						if (!fs.statSync(workspacePath).isDirectory()) return {
							id: correlationId,
							type: "response",
							command: "new_session",
							success: false,
							error: "Workspace path is not a directory"
						};
					} catch {
						return {
							id: correlationId,
							type: "response",
							command: "new_session",
							success: false,
							error: "Workspace path not found"
						};
					}
					ensureRegisteredWorkspace(workspacePath);
				}
				const created = await this.sessionRuntime.createDetachedSession({
					workspacePath,
					transcriptLimit: command.limit
				});
				this.transcriptProjector.syncPage(created.transcript);
				return {
					id: correlationId,
					type: "response",
					command: "new_session",
					success: true,
					data: {
						transcript: created.transcript,
						treeEntries: created.treeEntries,
						sessionId: created.sessionId,
						sessionName: created.sessionName,
						sessionPath: created.sessionPath,
						workspacePath: created.workspacePath,
						cancelled: false
					}
				};
			}
			case "register_workspace": {
				const selectedWorkspacePath = normalizeOptionalWorkspaceRoot(command.workspacePath) || pickWorkspaceDirectoryFromNativeDialog();
				if (!selectedWorkspacePath) return {
					id: correlationId,
					type: "response",
					command: "register_workspace",
					success: true,
					data: {
						workspaceId: "",
						workspaceName: "",
						workspacePath: "",
						created: false,
						cancelled: true
					}
				};
				try {
					if (!fs.statSync(selectedWorkspacePath).isDirectory()) return {
						id: correlationId,
						type: "response",
						command: "register_workspace",
						success: false,
						error: "Workspace path is not a directory"
					};
				} catch {
					return {
						id: correlationId,
						type: "response",
						command: "register_workspace",
						success: false,
						error: "Workspace path not found"
					};
				}
				const registered = ensureRegisteredWorkspace(selectedWorkspacePath);
				return {
					id: correlationId,
					type: "response",
					command: "register_workspace",
					success: true,
					data: {
						...registered.metadata,
						created: registered.created,
						cancelled: false
					}
				};
			}
			case "switch_session": try {
				const sessionPath = command.sessionPath;
				const cachedSessionManager = sessionPath ? this.sessionRuntime.getCachedSessionManager(sessionPath) : null;
				if (!sessionPath || !cachedSessionManager && !fs.existsSync(sessionPath)) return {
					id: correlationId,
					type: "response",
					command: "switch_session",
					success: false,
					error: "Session file not found"
				};
				const selected = await this.sessionRuntime.switchToStoredSession(sessionPath, command.limit);
				this.transcriptProjector.syncPage(selected.transcript);
				return {
					id: correlationId,
					type: "response",
					command: "switch_session",
					success: true,
					data: {
						transcript: selected.transcript,
						treeEntries: selected.treeEntries,
						sessionId: selected.sessionId,
						sessionName: selected.sessionName,
						sessionPath: selected.sessionPath,
						workspacePath: selected.workspacePath,
						cancelled: false
					}
				};
			} catch (err) {
				return {
					id: correlationId,
					type: "response",
					command: "switch_session",
					success: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
			case "set_session_name": {
				const name = command.name.trim();
				if (!name) return {
					id: correlationId,
					type: "response",
					command: "set_session_name",
					success: false,
					error: "Session name cannot be empty"
				};
				const sessionPath = command.sessionPath?.trim() || null;
				if (sessionPath) {
					if (!fs.existsSync(sessionPath)) return {
						id: correlationId,
						type: "response",
						command: "set_session_name",
						success: false,
						error: "Session file not found"
					};
					const activeSession = this.sessionRuntime.getDetachedSession();
					if (activeSession && this.sessionRuntime.currentDetachedSessionPath() === sessionPath) activeSession.setSessionName(name);
					else (this.sessionRuntime.getCachedSessionManager(sessionPath) ?? openSessionManager(sessionPath)).appendSessionInfo(name);
				} else if (this.sessionRuntime.hasDetachedSelection()) (await this.sessionRuntime.ensureDetachedSession()).setSessionName(name);
				else this.context.actions.setSessionName(name);
				this.sendSelectedSessionQueueUpdate();
				this.sessionStatsPusher.queue(this.sessionRuntime.currentTranscriptSessionPath());
				return {
					id: correlationId,
					type: "response",
					command: "set_session_name",
					success: true
				};
			}
			case "delete_session": {
				const sessionPath = command.sessionPath;
				if (!sessionPath || !fs.existsSync(sessionPath)) return {
					id: correlationId,
					type: "response",
					command: "delete_session",
					success: false,
					error: "Session file not found"
				};
				if (this.sessionRuntime.isSessionRunning(sessionPath)) return {
					id: correlationId,
					type: "response",
					command: "delete_session",
					success: false,
					error: "Cannot delete a running session"
				};
				if (this.sessionRuntime.currentDetachedSessionPath() === sessionPath) {
					this.sessionRuntime.clearSelection();
					this.sendTranscriptSnapshot({
						sessionPath: void 0,
						messages: [],
						hasOlder: false,
						hasNewer: false
					});
					this.sessionStatsPusher.queue(null);
				}
				this.detachedSessionRegistry.removeSession(sessionPath);
				fs.unlinkSync(sessionPath);
				return {
					id: correlationId,
					type: "response",
					command: "delete_session",
					success: true
				};
			}
			case "fork": {
				const currentSessionFile = this.sessionRuntime.currentTranscriptSessionPath() ?? this.context.state.sessionManager.getSessionFile();
				if (!currentSessionFile || !fs.existsSync(currentSessionFile)) return {
					id: correlationId,
					type: "response",
					command: "fork",
					success: false,
					error: "No session file available to fork from"
				};
				const newSessionPath = openSessionManager(currentSessionFile).createBranchedSession(command.entryId);
				if (!newSessionPath) return {
					id: correlationId,
					type: "response",
					command: "fork",
					success: false,
					error: "Failed to create forked session"
				};
				const entry = (await this.sessionRuntime.switchToStoredSession(newSessionPath)).sessionManager.getEntry(command.entryId);
				return {
					id: correlationId,
					type: "response",
					command: "fork",
					success: true,
					data: {
						text: entry && "message" in entry ? entry.message.content ?? "" : "",
						cancelled: false
					}
				};
			}
			case "get_fork_messages": return {
				id: correlationId,
				type: "response",
				command: "get_fork_messages",
				success: false,
				error: "get_fork_messages not supported via bridge"
			};
			case "get_last_assistant_text": return {
				id: correlationId,
				type: "response",
				command: "get_last_assistant_text",
				success: false,
				error: "get_last_assistant_text not supported via bridge"
			};
			case "export_html": return {
				id: correlationId,
				type: "response",
				command: "export_html",
				success: false,
				error: "export_html not supported via bridge"
			};
			case "get_messages": {
				const direction = command.direction === "older" ? "older" : "latest";
				const page = this.sessionRuntime.buildCurrentTranscriptPage({
					direction,
					cursor: command.cursor,
					limit: command.limit
				});
				if (direction === "latest") this.transcriptProjector.syncPage(page);
				return {
					id: correlationId,
					type: "response",
					command: "get_messages",
					success: true,
					data: {
						...page,
						direction
					}
				};
			}
			case "get_commands": return {
				id: correlationId,
				type: "response",
				command: "get_commands",
				success: true,
				data: { commands: this.context.actions.getCommands().map((cmd) => ({
					name: cmd.name,
					description: cmd.description,
					source: "extension"
				})) }
			};
			case "select_tree_entry": {
				let session;
				try {
					session = this.sessionRuntime.hasDetachedSelection() ? await this.sessionRuntime.ensureDetachedSession({ skipInitialSnapshot: true }) : await this.sessionRuntime.ensureDetachedSessionFromLive({ skipInitialSnapshot: true });
				} catch (error) {
					return {
						id: correlationId,
						type: "response",
						command: "select_tree_entry",
						success: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
				if (!session.sessionManager.getEntry(command.entryId)) return {
					id: correlationId,
					type: "response",
					command: "select_tree_entry",
					success: false,
					error: "Tree entry not found"
				};
				session.sessionManager.branch(command.entryId);
				const sessionPath = session.sessionFile ?? session.sessionManager.getSessionFile() ?? this.sessionRuntime.currentDetachedSessionPath();
				if (!sessionPath) return {
					id: correlationId,
					type: "response",
					command: "select_tree_entry",
					success: false,
					error: "No session file available"
				};
				return this.buildSelectTreeEntryResponse(correlationId, session.sessionManager, sessionPath, command.entryId);
			}
			case "navigate_tree": {
				let session;
				try {
					session = this.sessionRuntime.hasDetachedSelection() ? await this.sessionRuntime.ensureDetachedSession({ skipInitialSnapshot: true }) : await this.sessionRuntime.ensureDetachedSessionFromLive({ skipInitialSnapshot: true });
				} catch (error) {
					return {
						id: correlationId,
						type: "response",
						command: "navigate_tree",
						success: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
				const result = await session.navigateTree(command.entryId, {
					summarize: command.summarize,
					customInstructions: command.customInstructions,
					replaceInstructions: command.replaceInstructions,
					label: command.label
				});
				this.sendTranscriptSnapshot(buildTranscriptPage(flattenMessagesForTranscript(session.sessionManager.getBranch()), session.sessionFile ?? null));
				this.sessionStatsPusher.queue(session.sessionFile ?? null);
				return {
					id: correlationId,
					type: "response",
					command: "navigate_tree",
					success: true,
					data: result
				};
			}
			case "list_workspaces": try {
				const workspaces = /* @__PURE__ */ new Map();
				const appendSessionManagerWorkspace = (sessionManager, fallbackWorkspacePath) => {
					const header = sessionManager.getHeader();
					appendWorkspaceSummary(workspaces, sessionManager.getCwd() || header?.cwd || fallbackWorkspacePath, header?.timestamp);
				};
				for (const registeredWorkspace of listRegisteredWorkspaces()) appendWorkspaceSummary(workspaces, registeredWorkspace.workspacePath, readWorkspaceUpdatedAt(registeredWorkspace.workspacePath));
				appendSessionManagerWorkspace(this.context.state.sessionManager, this.context.state.cwd);
				for (const sessionManager of this.sessionRuntime.getCachedSessionManagers()) appendSessionManagerWorkspace(sessionManager, this.context.state.cwd);
				return {
					id: correlationId,
					type: "response",
					command: "list_workspaces",
					success: true,
					data: { workspaces: [...workspaces.values()].sort(compareWorkspaceSummaries) }
				};
			} catch {
				return {
					id: correlationId,
					type: "response",
					command: "list_workspaces",
					success: true,
					data: { workspaces: [] }
				};
			}
			case "list_sessions": {
				const workspacePath = normalizeOptionalWorkspaceRoot(command.workspacePath);
				const merge = command.merge;
				if (!workspacePath) return {
					id: correlationId,
					type: "response",
					command: "list_sessions",
					success: false,
					error: "workspacePath is required"
				};
				try {
					const sessions = [];
					const seenSessionPaths = /* @__PURE__ */ new Set();
					const liveSessionFile = this.context.state.sessionManager.getSessionFile();
					const cursor = decodeSessionCursor(command.cursor);
					const limit = typeof command.limit === "number" && command.limit > 0 ? Math.floor(command.limit) : void 0;
					const appendSession = (session) => {
						if (!session || seenSessionPaths.has(session.path)) return;
						if (normalizeOptionalWorkspaceRoot(session.workspacePath ?? session.workspaceId) !== workspacePath) return;
						seenSessionPaths.add(session.path);
						sessions.push(session);
					};
					const appendSessionManager = (sessionManager, sessionPath, fallbackWorkspacePath, options) => {
						if (!sessionPath) return;
						if (options?.requireOnDisk !== false && !fs.existsSync(sessionPath)) return;
						const header = sessionManager.getHeader();
						if (!header) return;
						const workspace = workspaceMetadata(sessionManager.getCwd() || header.cwd || fallbackWorkspacePath, sessionPath);
						const sessionMtime = safeStatMtime(sessionPath);
						appendSession({
							id: header.id,
							name: sessionDisplayName(sessionManager, sessionPath),
							path: sessionPath,
							isRunning: sessionPath === liveSessionFile ? !this.context.state.isIdle() : this.sessionRuntime.isSessionRunning(sessionPath),
							timestamp: normalizeSessionTimestamp(header.timestamp),
							updatedAt: normalizeSessionTimestamp(sessionMtime ?? header.timestamp),
							...workspace,
							parentSession: header.parentSession
						});
					};
					for (const sessionPath of listWorkspaceSessionFiles(workspacePath)) appendSession(readWorkspaceSessionSummary(sessionPath, sessionPath === liveSessionFile ? !this.context.state.isIdle() : this.sessionRuntime.isSessionRunning(sessionPath)));
					if (command.includeActive !== false) {
						appendSessionManager(this.context.state.sessionManager, liveSessionFile, this.context.state.cwd);
						for (const sessionManager of this.sessionRuntime.getCachedSessionManagers()) appendSessionManager(sessionManager, sessionManager.getSessionFile(), this.context.state.cwd, { requireOnDisk: false });
					}
					const activeSessionPath = this.sessionRuntime.currentTranscriptSessionPath() ?? liveSessionFile;
					const allSessionPaths = new Set(sessions.map((s) => s.path));
					const filteredSessions = sessions.filter((session) => {
						if (!session.parentSession) return true;
						if (!allSessionPaths.has(session.parentSession)) return true;
						if (session.path === liveSessionFile) return true;
						if (session.path === activeSessionPath) return true;
						return false;
					}).filter((session) => isAfterSessionCursor(session, cursor)).filter((session) => sessionMatchesListQuery(session, command.query)).sort(compareSessionsByRecency);
					const limitedSessions = limit ? filteredSessions.slice(0, limit) : filteredSessions;
					const pageSessions = [...limitedSessions];
					if (command.includeActive !== false && activeSessionPath) {
						const activeSession = filteredSessions.find((session) => session.path === activeSessionPath);
						if (activeSession && !pageSessions.some((session) => session.path === activeSession.path)) pageSessions.push(activeSession);
					}
					return {
						id: correlationId,
						type: "response",
						command: "list_sessions",
						success: true,
						data: {
							sessions: pageSessions,
							workspacePath,
							nextCursor: limit && filteredSessions.length > limitedSessions.length ? encodeSessionCursor(limitedSessions[limitedSessions.length - 1]) : void 0,
							merge
						}
					};
				} catch {
					return {
						id: correlationId,
						type: "response",
						command: "list_sessions",
						success: true,
						data: {
							sessions: [],
							workspacePath,
							merge
						}
					};
				}
			}
			case "list_tree_entries": try {
				const requestedSessionPath = command.sessionPath;
				const liveSessionPath = this.sessionRuntime.currentTranscriptSessionPath() ?? this.context.state.sessionManager.getSessionFile();
				const sessionPath = requestedSessionPath ?? liveSessionPath;
				return {
					id: correlationId,
					type: "response",
					command: "list_tree_entries",
					success: true,
					data: {
						entries: sessionPath && fs.existsSync(sessionPath) ? buildTreeEntriesForSessionPath(sessionPath) : buildTreeEntriesFromBranch(this.context.state.sessionManager.getBranch()),
						sessionPath: sessionPath ?? void 0
					}
				};
			} catch {
				return {
					id: correlationId,
					type: "response",
					command: "list_tree_entries",
					success: true,
					data: {
						entries: [],
						sessionPath: command.sessionPath
					}
				};
			}
			case "list_workspace_entries": {
				const cwd = normalizeOptionalWorkspaceRoot(command.workspacePath) || this.sessionRuntime.currentGitCwd();
				if (command.force || !this.workspaceEntriesCache || this.workspaceEntriesCache.cwd !== cwd) this.workspaceEntriesCache = {
					cwd,
					entries: listWorkspaceEntries(cwd)
				};
				return {
					id: correlationId,
					type: "response",
					command: "list_workspace_entries",
					success: true,
					data: { entries: this.workspaceEntriesCache.entries }
				};
			}
			case "list_directory_entries": {
				const workspaceRoot = normalizeOptionalWorkspaceRoot(command.workspacePath) || this.sessionRuntime.currentGitCwd();
				if (!workspaceRoot) return {
					id: correlationId,
					type: "response",
					command: "list_directory_entries",
					success: false,
					error: "No workspace root"
				};
				const result = listDirectoryEntries(workspaceRoot, command.path);
				if ("error" in result) return {
					id: correlationId,
					type: "response",
					command: "list_directory_entries",
					success: false,
					error: result.error
				};
				return {
					id: correlationId,
					type: "response",
					command: "list_directory_entries",
					success: true,
					data: { entries: result }
				};
			}
			case "read_workspace_file": {
				const result = readWorkspaceFile(normalizeOptionalWorkspaceRoot(command.workspacePath) || this.sessionRuntime.currentGitCwd(), command.path);
				if ("error" in result) return {
					id: correlationId,
					type: "response",
					command: "read_workspace_file",
					success: false,
					error: result.error
				};
				return {
					id: correlationId,
					type: "response",
					command: "read_workspace_file",
					success: true,
					data: result
				};
			}
			case "write_workspace_file": {
				const result = writeWorkspaceFile(normalizeOptionalWorkspaceRoot(command.workspacePath) || this.sessionRuntime.currentGitCwd(), command.path, command.content);
				if ("error" in result) return {
					id: correlationId,
					type: "response",
					command: "write_workspace_file",
					success: false,
					error: result.error
				};
				return {
					id: correlationId,
					type: "response",
					command: "write_workspace_file",
					success: true,
					data: result
				};
			}
			case "list_git_branches": {
				const repoState = readGitRepoState(this.sessionRuntime.currentGitCwd());
				if (!repoState) return {
					id: correlationId,
					type: "response",
					command: "list_git_branches",
					success: false,
					error: "No git repository found for the active session"
				};
				return {
					id: correlationId,
					type: "response",
					command: "list_git_branches",
					success: true,
					data: repoState
				};
			}
			case "list_diff_entries": {
				const cwd = this.sessionRuntime.currentGitCwd();
				if (!cwd) return {
					id: correlationId,
					type: "response",
					command: "list_diff_entries",
					success: false,
					error: "No working directory for the active session"
				};
				return {
					id: correlationId,
					type: "response",
					command: "list_diff_entries",
					success: true,
					data: { entries: parseGitDiff(cwd) }
				};
			}
			case "switch_git_branch": {
				const branchName = command.branchName.trim();
				if (!branchName) return {
					id: correlationId,
					type: "response",
					command: "switch_git_branch",
					success: false,
					error: "Branch name cannot be empty"
				};
				const activeState = this.sessionRuntime.buildActiveState();
				if (activeState.isStreaming || activeState.isCompacting) return {
					id: correlationId,
					type: "response",
					command: "switch_git_branch",
					success: false,
					error: "Cannot switch branches while the active session is busy"
				};
				const repoState = readGitRepoState(this.sessionRuntime.currentGitCwd());
				if (!repoState) return {
					id: correlationId,
					type: "response",
					command: "switch_git_branch",
					success: false,
					error: "No git repository found for the active session"
				};
				if (repoState.currentBranch === branchName) return {
					id: correlationId,
					type: "response",
					command: "switch_git_branch",
					success: true,
					data: repoState
				};
				const targetBranch = repoState.branches.find((branch) => branch.name === branchName);
				if (!targetBranch) return {
					id: correlationId,
					type: "response",
					command: "switch_git_branch",
					success: false,
					error: `Branch not found: ${branchName}`
				};
				const localBranch = repoState.branches.find((branch) => branch.kind === "local" && branch.shortName === targetBranch.shortName);
				const switchArgs = targetBranch.kind === "local" ? ["switch", targetBranch.name] : localBranch ? ["switch", localBranch.name] : [
					"switch",
					"--track",
					targetBranch.name
				];
				const switchResult = runGitCommand(repoState.repoRoot, switchArgs, 1e4);
				if (switchResult.error || switchResult.status !== 0) return {
					id: correlationId,
					type: "response",
					command: "switch_git_branch",
					success: false,
					error: [switchResult.stderr, switchResult.stdout].map((value) => readSpawnText(value).trim()).filter(Boolean).join("\n") || `Failed to switch to ${branchName}`
				};
				this.workspaceEntriesCache = null;
				const nextRepoState = readGitRepoState(repoState.repoRoot);
				if (!nextRepoState) return {
					id: correlationId,
					type: "response",
					command: "switch_git_branch",
					success: false,
					error: "Branch switched, but the repository state could not be refreshed"
				};
				return {
					id: correlationId,
					type: "response",
					command: "switch_git_branch",
					success: true,
					data: nextRepoState
				};
			}
			case "create_git_branch": {
				const branchName = command.branchName.trim();
				if (!branchName) return {
					id: correlationId,
					type: "response",
					command: "create_git_branch",
					success: false,
					error: "Branch name cannot be empty"
				};
				const activeState = this.sessionRuntime.buildActiveState();
				if (activeState.isStreaming || activeState.isCompacting) return {
					id: correlationId,
					type: "response",
					command: "create_git_branch",
					success: false,
					error: "Cannot create branches while the active session is busy"
				};
				const repoState = readGitRepoState(this.sessionRuntime.currentGitCwd());
				if (!repoState) return {
					id: correlationId,
					type: "response",
					command: "create_git_branch",
					success: false,
					error: "No git repository found for the active session"
				};
				const branchNameCheck = runGitCommand(repoState.repoRoot, [
					"check-ref-format",
					"--branch",
					branchName
				]);
				if (branchNameCheck.error || branchNameCheck.status !== 0) return {
					id: correlationId,
					type: "response",
					command: "create_git_branch",
					success: false,
					error: `Invalid branch name: ${branchName}`
				};
				if (repoState.branches.some((branch) => branch.kind === "local" && branch.name === branchName)) return {
					id: correlationId,
					type: "response",
					command: "create_git_branch",
					success: false,
					error: `Branch already exists: ${branchName}`
				};
				const createResult = runGitCommand(repoState.repoRoot, [
					"switch",
					"-c",
					branchName
				], 1e4);
				if (createResult.error || createResult.status !== 0) return {
					id: correlationId,
					type: "response",
					command: "create_git_branch",
					success: false,
					error: [createResult.stderr, createResult.stdout].map((value) => readSpawnText(value).trim()).filter(Boolean).join("\n") || `Failed to create ${branchName}`
				};
				this.workspaceEntriesCache = null;
				const nextRepoState = readGitRepoState(repoState.repoRoot);
				if (!nextRepoState) return {
					id: correlationId,
					type: "response",
					command: "create_git_branch",
					success: false,
					error: "Branch created, but the repository state could not be refreshed"
				};
				return {
					id: correlationId,
					type: "response",
					command: "create_git_branch",
					success: true,
					data: nextRepoState
				};
			}
			default: {
				const unknownCommand = command;
				return {
					id: correlationId,
					type: "response",
					command: unknownCommand.type,
					success: false,
					error: `Unknown command: ${unknownCommand.type}`
				};
			}
		}
	}
	handleUIResponse(response) {
		this.uiBridge.handleResponse(response);
	}
	createExtensionUIContext() {
		return this.uiBridge.createContext();
	}
	sendResponse(message) {
		if (this.disposed || this.ws.readyState !== 1) return;
		try {
			this.ws.send(JSON.stringify(message));
		} catch (err) {
			console.error(`WsRpcAdapter[${this.client.id}]: Failed to send response:`, err);
		}
	}
	/**
	* Dispose the adapter, cleaning up pending requests and subscriptions
	*/
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		console.log(`WsRpcAdapter[${this.client.id}]: Disposing adapter`);
		if (this.pendingTranscriptDeltaBatch) {
			clearTimeout(this.pendingTranscriptDeltaBatch.timeoutId);
			this.pendingTranscriptDeltaBatch = null;
		}
		this.uiBridge.dispose();
		this.sessionStatsPusher.dispose();
		if (this.unsubscribeRegistryEvents) {
			this.unsubscribeRegistryEvents();
			this.unsubscribeRegistryEvents = void 0;
		}
		this.sessionRuntime.dispose();
		this.emitEvent({
			type: "client_disconnect",
			client: this.client,
			reason: "adapter_disposed"
		});
	}
};
//#endregion
//#region src/lifecycle.ts
/**
* Bridge lifecycle management.
*
* Handles:
* - startBridge() with port range fallback
* - SIGINT handler registration and cleanup
* - Wiring Pi's ExtensionAPI context into the RPC adapter
* - stop() that closes everything and invokes done() callback
*/
async function startBridge(config, context, done, options = {}) {
	const eventBus = new BridgeEventBus(config);
	const eventHandlers = [];
	const sessionRegistry = options.sessionRegistry ?? new DetachedSessionRegistry(context.state.cwd);
	const ownsSessionRegistry = !options.sessionRegistry;
	const emitEvent = (event) => {
		for (const handler of eventHandlers) try {
			handler(event);
		} catch (err) {
			console.error("Bridge lifecycle: event handler error:", err);
		}
		eventBus.emit(event);
	};
	const handlerFactory = (connCtx) => {
		return new WsRpcAdapter(connCtx.client, connCtx.ws, context, connCtx.config, connCtx.eventBus, connCtx.emitEvent, sessionRegistry);
	};
	const server = new BridgeServer(config, handlerFactory, eventBus, emitEvent);
	let state = {
		status: "starting",
		port: config.port
	};
	try {
		const address = await server.start();
		state = {
			status: "running",
			host: address.host,
			port: address.port
		};
	} catch (err) {
		state = { status: "stopped" };
		throw err;
	}
	let sigintHandler;
	let shutdownPromise;
	/**
	* Graceful shutdown
	*/
	const shutdown = () => {
		if (shutdownPromise) return shutdownPromise;
		shutdownPromise = (async () => {
			state = { status: "stopping" };
			emitEvent({ type: "sigint_received" });
			if (sigintHandler) process.off("SIGINT", sigintHandler);
			try {
				await server.stop();
				eventBus.dispose();
				if (ownsSessionRegistry) sessionRegistry.dispose();
				state = { status: "stopped" };
				emitEvent({ type: "shutdown_complete" });
			} catch (err) {
				console.error("Bridge shutdown error:", err);
				state = { status: "stopped" };
				throw err;
			} finally {
				done();
			}
		})();
		return shutdownPromise;
	};
	if (options.captureSigint !== false) {
		sigintHandler = () => {
			console.log("\n[Bridge] SIGINT received, shutting down...");
			shutdown();
		};
		process.on("SIGINT", sigintHandler);
	}
	return {
		getState() {
			return state;
		},
		getBridgeUrl() {
			if (state.status === "running") return `http://${state.host}:${state.port}`;
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
				if (idx !== -1) eventHandlers.splice(idx, 1);
			};
		}
	};
}
//#endregion
//#region src/bridge-runtime.ts
const staticRuntime = {
	DEFAULT_BRIDGE_CONFIG,
	startBridge
};
async function loadBridgeRuntime(extensionEntryFile) {
	if (!resolveBridgeDevWatchPath(extensionEntryFile)) return staticRuntime;
	const runtimeEntryPath = join(dirname(resolve(extensionEntryFile)), "runtime-bridge-entry.ts");
	const { createJiti } = await import(["jiti", "static"].join("/"));
	return createJiti(import.meta.url, { moduleCache: false }).import(runtimeEntryPath, { default: true });
}
//#endregion
//#region src/exit-input.ts
const ESCAPE_CHAR = String.fromCharCode(27);
const LOCK_MODIFIER_MASK = 192;
const CTRL_MODIFIER = 4;
const CTRL_C_CODEPOINT = 99;
function hasOnlyCtrlModifier(modifierValue) {
	return (modifierValue - 1 & ~LOCK_MODIFIER_MASK) === CTRL_MODIFIER;
}
function isCtrlCInput$1(input) {
	if (input === "") return true;
	if (input.startsWith(`${ESCAPE_CHAR}[`) && input.endsWith("u")) {
		const kittyMatch = input.slice(2).match(/^(\d+)(?::\d*)?(?::\d+)?(?:;(\d+))?(?::\d+)?u$/);
		if (kittyMatch) {
			const codepoint = Number(kittyMatch[1]);
			const modifierValue = Number(kittyMatch[2] ?? "1");
			return codepoint === CTRL_C_CODEPOINT && hasOnlyCtrlModifier(modifierValue);
		}
	}
	if (input.startsWith(`${ESCAPE_CHAR}[27;`) && input.endsWith("~")) {
		const modifyOtherKeysMatch = input.slice(2).match(/^27;(\d+);(\d+)~$/);
		if (modifyOtherKeysMatch) {
			const modifierValue = Number(modifyOtherKeysMatch[1]);
			return Number(modifyOtherKeysMatch[2]) === CTRL_C_CODEPOINT && hasOnlyCtrlModifier(modifierValue);
		}
	}
	return false;
}
function isBridgeExitInput(input, keybindings) {
	if (isCtrlCInput$1(input)) return true;
	if (!keybindings?.matches) return false;
	return keybindings.matches(input, "selectCancel") || keybindings.matches(input, "copy");
}
//#endregion
//#region src/pi-live-session.ts
function createBridgeSessionEvents(pi) {
	return { subscribe(handler) {
		pi.on("agent_start", () => {
			handler({ type: "agent_start" });
		});
		pi.on("agent_end", (event) => {
			handler({
				type: "agent_end",
				messages: event.messages
			});
		});
		pi.on("message_start", (event) => {
			handler({
				type: "message_start",
				...event
			});
		});
		pi.on("message_update", (event) => {
			handler({
				type: "message_update",
				...event
			});
		});
		pi.on("message_end", (event) => {
			handler({
				type: "message_end",
				...event
			});
		});
		pi.on("session_compact", () => {
			handler({ type: "session_compact" });
		});
		pi.on("model_select", (event) => {
			const e = event;
			handler({
				type: "model_select",
				model: e.model,
				previousModel: e.previousModel,
				source: e.source
			});
		});
		return () => {};
	} };
}
function createBridgeSessionState(ctx, pi) {
	return {
		sessionManager: ctx.sessionManager,
		get cwd() {
			return ctx.cwd;
		},
		isIdle() {
			return ctx.isIdle();
		},
		hasPendingMessages() {
			return ctx.hasPendingMessages();
		},
		getAvailableModels() {
			return ctx.modelRegistry.getAvailable();
		},
		getCurrentModel() {
			return ctx.model;
		},
		getThinkingLevel() {
			return pi.getThinkingLevel();
		},
		getContextUsage() {
			return ctx.getContextUsage() ?? null;
		}
	};
}
function createBridgeSessionActions(pi, ctx) {
	return {
		sendUserMessage(content, options) {
			pi.sendUserMessage(content, { deliverAs: options.deliverAs });
		},
		abort() {
			ctx.abort();
		},
		async setModel(model) {
			await pi.setModel(model);
		},
		setThinkingLevel(level) {
			pi.setThinkingLevel(level);
		},
		setSessionName(name) {
			pi.setSessionName(name);
		},
		getCommands() {
			return pi.getCommands().map((c) => ({
				name: c.name,
				description: c.description
			}));
		}
	};
}
//#endregion
//#region src/terminal-log-view.ts
/**
* Terminal log view for the bridge.
*
* Renders bridge URL, client count, recent log lines (circular buffer),
* and Ctrl+C instructions. Works within Pi's ctx.ui.custom() pattern.
* Read-only: handleInput handles only bridge-exit shortcuts.
*/
function isCtrlCInput(input) {
	return input === "";
}
function createBridgeTerminalView(subscribe, getState, getClients, _config, onUpdate) {
	const maxLines = 100;
	const logs = [];
	let exitRequested = false;
	const addLog = (message, type = "info", forceUpdate = false) => {
		logs.push({
			timestamp: /* @__PURE__ */ new Date(),
			message,
			type
		});
		if (logs.length > maxLines) logs.shift();
		onUpdate?.(forceUpdate);
	};
	const requestExit = () => {
		exitRequested = true;
		onUpdate?.(true);
	};
	const unsubscribe = subscribe((event) => {
		switch (event.type) {
			case "server_start": {
				const lanIps = getLanIps();
				const lanInfo = lanIps.length > 0 ? ` (LAN: ${lanIps.map((ip) => {
					const label = isTailscaleIp(ip) ? " [Tailscale]" : "";
					return `http://${ip}:${event.port}${label}`;
				}).join(", ")})` : "";
				addLog(`Server started on ${event.host}:${event.port}${lanInfo}`, "info", true);
				break;
			}
			case "server_stop":
				addLog("Server stopped", "info", true);
				break;
			case "client_connect":
				addLog(`Client #${event.client.seq} connected (${event.client.id.slice(0, 12)}...)`, "client", true);
				break;
			case "client_disconnect":
				addLog(`Client #${event.client.seq} disconnected: ${event.reason || "unknown"}`, "client", true);
				break;
			case "command_received":
				addLog(`Command [${event.commandType}] from #${event.client.seq}${event.correlationId ? ` (id: ${event.correlationId.slice(0, 8)}...)` : ""}`, "info");
				break;
			case "command_error":
				addLog(`Error [${event.commandType}] from #${event.client.seq}${event.correlationId ? ` (id: ${event.correlationId.slice(0, 8)}...)` : ""}: ${event.error}`, "error");
				break;
			case "sigint_received":
				addLog("SIGINT received, starting shutdown...", "shutdown", true);
				break;
			case "shutdown_complete":
				addLog("Shutdown complete", "shutdown", true);
				break;
			case "auth_rejected":
				addLog(`Auth rejected (${event.protocol}) from ${event.clientIp}`, "error");
				break;
		}
	});
	const formatTime = (date) => {
		return date.toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit"
		});
	};
	const getStatusIndicator = (status) => {
		switch (status) {
			case "running": return "🟢";
			case "starting": return "🟡";
			case "stopping": return "🟠";
			default: return "⚪";
		}
	};
	return {
		render() {
			const state = getState();
			const clients = getClients();
			const lines = [];
			lines.push("╔══════════════════════════════════════════════════════════════╗");
			lines.push("║              🌉 Pi Web Bridge - Terminal View                ║");
			lines.push("╚══════════════════════════════════════════════════════════════╝");
			lines.push("");
			const statusIndicator = getStatusIndicator(state.status);
			if (state.status === "running") {
				lines.push(`${statusIndicator} Bridge: http://localhost:${state.port}`);
				for (const ip of getLanIps()) {
					const tailscaleLabel = isTailscaleIp(ip) ? " (Tailscale)" : "";
					lines.push(`  📡 LAN: http://${ip}:${state.port}${tailscaleLabel}`);
				}
				lines.push(`  WebSocket: ws://localhost:${state.port}/ws`);
			} else if (state.status === "starting") lines.push(`${statusIndicator} Starting on port ${state.port}...`);
			else if (state.status === "stopping") lines.push(`${statusIndicator} Shutting down...`);
			else lines.push(`${statusIndicator} Bridge stopped`);
			lines.push(`  Clients: ${clients.length}`);
			lines.push("");
			if (clients.length > 0) {
				lines.push("Connected clients:");
				for (const client of clients.slice(-3)) {
					const time = formatTime(new Date(client.connectedAt));
					lines.push(`  #${client.seq} ${client.id.slice(0, 16)}... @ ${time}`);
				}
				if (clients.length > 3) lines.push(`  ... and ${clients.length - 3} more`);
				lines.push("");
			}
			lines.push("─".repeat(62));
			lines.push("Event log:");
			lines.push("─".repeat(62));
			if (logs.length === 0) lines.push("  (No events yet - waiting for activity)");
			else for (const entry of logs.slice(-15)) {
				const prefix = entry.type === "client" ? "[C]" : entry.type === "error" ? "[E]" : entry.type === "shutdown" ? "[X]" : "[I]";
				lines.push(`${formatTime(entry.timestamp)} ${prefix} ${entry.message}`);
			}
			lines.push("");
			lines.push("─".repeat(62));
			lines.push("Press Ctrl+C to stop the bridge");
			return lines;
		},
		handleInput(input) {
			if (isCtrlCInput(input)) requestExit();
		},
		shouldExit() {
			return exitRequested;
		},
		requestExit() {
			requestExit();
		},
		dispose() {
			unsubscribe();
		}
	};
}
//#endregion
//#region src/index.ts
/**
* Pi Extension Entry Point - Web Bridge
*
* Registers the `/web` command that starts the bridge server,
* degrades the terminal to a read-only log view, and allows
* browser clients to interact with Pi via WebSocket RPC.
*/
const HEADLESS_ENV = "PI_WEB_HEADLESS";
const READY_FILE_ENV = "PI_WEB_READY_FILE";
const SHUTDOWN_FILE_ENV = "PI_WEB_SHUTDOWN_FILE";
const SHUTDOWN_POLL_MS = 200;
function isTruthyEnv(value) {
	if (!value) return false;
	switch (value.trim().toLowerCase()) {
		case "0":
		case "false":
		case "no":
		case "off": return false;
		default: return true;
	}
}
function parseWebCommandOptions(args, env = process.env, hasUI = true) {
	return {
		headless: args.split(/\s+/).map((token) => token.trim()).filter(Boolean).includes("--headless") || isTruthyEnv(env[HEADLESS_ENV]) || !hasUI,
		readyFile: env[READY_FILE_ENV],
		shutdownFile: env[SHUTDOWN_FILE_ENV]
	};
}
async function writeReadyFile(readyFile, payload) {
	await mkdir(dirname(readyFile), { recursive: true });
	await writeFile(`${readyFile}`, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
function buildBridgeConfig(runtime, staticDir) {
	return {
		...runtime.DEFAULT_BRIDGE_CONFIG,
		port: process.env.PI_BRIDGE_PORT ? parseInt(process.env.PI_BRIDGE_PORT, 10) : runtime.DEFAULT_BRIDGE_CONFIG.port,
		host: process.env.PI_BRIDGE_HOST || runtime.DEFAULT_BRIDGE_CONFIG.host,
		staticDir
	};
}
async function runHeadlessWebBridge(config, startBridge, adapterContext, options, ctx, extensionEntryFile, sessionRegistry) {
	let resolveStopped;
	const stopped = new Promise((resolve) => {
		resolveStopped = resolve;
	});
	const bridgeController = await startBridge(config, adapterContext, () => resolveStopped?.(), {
		captureSigint: false,
		sessionRegistry
	});
	const bridgeUrl = bridgeController.getBridgeUrl();
	if (!bridgeUrl) {
		await bridgeController.stop();
		throw new Error("Bridge started without a reachable URL");
	}
	const wsUrl = `${bridgeUrl.replace(/^http/, "ws")}/ws`;
	console.log(`[pi-web] Bridge URL: ${bridgeUrl}`);
	console.log(`[pi-web] WebSocket: ${wsUrl}`);
	if (options.readyFile) await writeReadyFile(options.readyFile, {
		bridgeUrl,
		wsUrl
	});
	const requestStop = async () => {
		await bridgeController.stop().catch((err) => {
			console.error("[pi-web] Failed to stop bridge:", err);
		});
	};
	const devReload = createBridgeDevReloadController({
		extensionEntryFile,
		stop: requestStop
	});
	const onSigint = () => {
		requestStop();
	};
	const onSigterm = () => {
		requestStop();
	};
	const onAbort = () => {
		requestStop();
	};
	process.on("SIGINT", onSigint);
	process.on("SIGTERM", onSigterm);
	ctx.signal?.addEventListener("abort", onAbort, { once: true });
	const shutdownPoll = options.shutdownFile ? setInterval(() => {
		if (existsSync(options.shutdownFile)) requestStop();
	}, SHUTDOWN_POLL_MS) : void 0;
	shutdownPoll?.unref();
	try {
		await stopped;
	} finally {
		process.off("SIGINT", onSigint);
		process.off("SIGTERM", onSigterm);
		ctx.signal?.removeEventListener("abort", onAbort);
		if (shutdownPoll) clearInterval(shutdownPoll);
		devReload?.dispose();
	}
	return devReload?.reloadRequested() ?? false;
}
async function runInteractiveWebBridge(config, startBridge, adapterContext, ctx, extensionEntryFile, sessionRegistry) {
	let bridgeController;
	let terminalView;
	let finishWebMode;
	let devReload = void 0;
	try {
		bridgeController = await startBridge(config, adapterContext, () => {
			terminalView?.requestExit();
			finishWebMode?.();
		}, {
			captureSigint: false,
			sessionRegistry
		});
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		await ctx.ui.custom((_tui, _theme, _kb, done) => {
			return {
				render() {
					return [
						`Error: ${errorMsg}`,
						"",
						"Press any key to exit..."
					];
				},
				handleInput() {
					done();
				},
				invalidate() {}
			};
		});
		return false;
	}
	const stdinExitHandler = (data) => {
		if (isBridgeExitInput(typeof data === "string" ? data : data.toString("utf8"))) finishWebMode?.();
	};
	process.stdin.on("data", stdinExitHandler);
	try {
		await ctx.ui.custom((tui, _theme, kb, done) => {
			let finishRequested = false;
			finishWebMode = () => {
				if (finishRequested) return;
				finishRequested = true;
				terminalView?.requestExit();
				done();
			};
			devReload ??= createBridgeDevReloadController({
				extensionEntryFile,
				stop: async () => {
					finishWebMode?.();
					await bridgeController?.stop();
				}
			});
			const view = createBridgeTerminalView((handler) => bridgeController.subscribe(handler), () => bridgeController.getState(), () => bridgeController.getClients(), config, (force) => tui.requestRender(force));
			terminalView = view;
			return {
				render() {
					return view.render();
				},
				handleInput(input) {
					view.handleInput(input);
					if (isBridgeExitInput(input, { matches: (candidate, action) => {
						if (action !== "selectCancel" && action !== "copy") return false;
						return kb.matches(candidate, action);
					} }) || view.shouldExit()) finishWebMode?.();
				},
				shouldExit() {
					return view.shouldExit();
				},
				invalidate() {
					tui.requestRender();
				},
				dispose() {
					view.dispose();
					queueMicrotask(() => tui.requestRender(true));
				}
			};
		});
	} finally {
		finishWebMode = void 0;
		process.stdin.off("data", stdinExitHandler);
		devReload?.dispose();
		terminalView?.dispose();
		if (bridgeController && bridgeController.getState().status !== "stopped") await bridgeController.stop();
	}
	return devReload?.reloadRequested() ?? false;
}
async function webBridgeHandler(args, ctx, pi) {
	const adapterContext = {
		events: createBridgeSessionEvents(pi),
		state: createBridgeSessionState(ctx, pi),
		actions: createBridgeSessionActions(pi, ctx)
	};
	const thisFile = fileURLToPath(import.meta.url);
	const webDistDir = join(join(dirname(thisFile), "..", ".."), "web-dist");
	const staticDir = existsSync(webDistDir) ? webDistDir : void 0;
	const options = parseWebCommandOptions(args, process.env, ctx.hasUI);
	const sessionRegistry = new DetachedSessionRegistry(adapterContext.state.cwd);
	try {
		while (true) {
			const bridgeRuntime = await loadBridgeRuntime(thisFile);
			const config = buildBridgeConfig(bridgeRuntime, staticDir);
			if (!(options.headless ? await runHeadlessWebBridge(config, bridgeRuntime.startBridge, adapterContext, options, ctx, thisFile, sessionRegistry) : await runInteractiveWebBridge(config, bridgeRuntime.startBridge, adapterContext, ctx, thisFile, sessionRegistry))) return;
			console.log("[pi-web] Bridge runtime reloaded.");
		}
	} finally {
		sessionRegistry.dispose();
	}
}
function registerWebBridge(pi, _state) {
	pi.registerCommand("web", {
		description: "Start web bridge server for browser-based interaction",
		handler: async (args, ctx) => {
			await webBridgeHandler(args, ctx, pi);
		}
	});
}
//#endregion
export { registerWebBridge as default, parseWebCommandOptions, webBridgeHandler };
