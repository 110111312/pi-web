import { BridgeEventBus } from "../bridge-event-bus.js";
import { BridgeServer } from "../server.js";
import { DetachedSessionRegistry } from "../session-registry.js";
import { WsRpcAdapter } from "../ws-rpc-adapter.js";
import { createStandaloneBridgeContext } from "./backend.js";
//#region src/standalone/server.ts
async function startStandaloneBridge(config, options = {}) {
	const eventBus = new BridgeEventBus(config);
	const eventHandlers = [];
	const backend = options.backend ?? await createStandaloneBridgeContext({
		cwd: options.cwd,
		sessionPath: options.sessionPath,
		sessionDir: options.sessionDir
	});
	const ownsBackend = !options.backend;
	const sessionRegistry = options.sessionRegistry ?? new DetachedSessionRegistry(backend.context.state.cwd);
	const ownsSessionRegistry = !options.sessionRegistry;
	const emitEvent = (event) => {
		for (const handler of eventHandlers) try {
			handler(event);
		} catch (error) {
			console.error("Standalone bridge lifecycle event handler error:", error);
		}
		eventBus.emit(event);
	};
	const handlerFactory = (connCtx) => {
		return new WsRpcAdapter(connCtx.client, connCtx.ws, backend.context, connCtx.config, connCtx.eventBus, connCtx.emitEvent, sessionRegistry);
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
	} catch (error) {
		state = { status: "stopped" };
		if (ownsSessionRegistry) sessionRegistry.dispose();
		if (ownsBackend) await backend.dispose();
		eventBus.dispose();
		throw error;
	}
	let sigintHandler;
	let shutdownPromise;
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
				if (ownsBackend) await backend.dispose();
				state = { status: "stopped" };
				emitEvent({ type: "shutdown_complete" });
			} catch (error) {
				console.error("Standalone bridge shutdown error:", error);
				state = { status: "stopped" };
				throw error;
			} finally {
				options.onShutdown?.();
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
				const index = eventHandlers.indexOf(handler);
				if (index !== -1) eventHandlers.splice(index, 1);
			};
		}
	};
}
//#endregion
export { startStandaloneBridge };
