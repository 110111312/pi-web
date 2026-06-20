//#region src/bridge-event-bus.ts
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
export { BridgeEventBus };
