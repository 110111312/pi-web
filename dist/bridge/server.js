import { getLanIps, isTailscaleIp } from "./network.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
//#region src/server.ts
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
export { BridgeServer };
