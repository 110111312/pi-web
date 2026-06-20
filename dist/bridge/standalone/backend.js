import { createDetachedAgentSession } from "../detached-session.js";
import { createHeadlessUIContext } from "../headless-ui-context.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
//#region src/standalone/backend.ts
function normalizeCommandName(name) {
	return name.startsWith("/") ? name : `/${name}`;
}
function listSessionCommands(session) {
	const commands = /* @__PURE__ */ new Map();
	for (const command of session.extensionRunner.getRegisteredCommands()) {
		const name = normalizeCommandName(command.name);
		commands.set(name, {
			name,
			description: command.description
		});
	}
	for (const template of session.promptTemplates) {
		const rawName = template.command ?? template.name;
		if (!rawName) continue;
		const name = normalizeCommandName(rawName);
		if (!commands.has(name)) commands.set(name, {
			name,
			description: template.description
		});
	}
	return [...commands.values()].sort((left, right) => left.name.localeCompare(right.name));
}
function toBridgeLiveEvent(event) {
	switch (event.type) {
		case "agent_start": return { type: "agent_start" };
		case "agent_end": return {
			type: "agent_end",
			messages: event.messages
		};
		case "message_start":
		case "message_update":
		case "message_end": return event;
		case "compaction_end": return { type: "session_compact" };
		default: return null;
	}
}
function createStandaloneBridgeContextFromSession(session) {
	let pendingMessageCount = 0;
	const liveEventHandlers = /* @__PURE__ */ new Set();
	const emitLiveEvent = (event) => {
		for (const handler of liveEventHandlers) try {
			handler(event);
		} catch (error) {
			console.error("Standalone bridge event handler error:", error);
		}
	};
	const unsubscribeSession = session.subscribe((event) => {
		if (event.type === "queue_update") {
			pendingMessageCount = event.steering.length + event.followUp.length;
			return;
		}
		const liveEvent = toBridgeLiveEvent(event);
		if (!liveEvent) return;
		emitLiveEvent(liveEvent);
	});
	return {
		context: {
			events: { subscribe(handler) {
				liveEventHandlers.add(handler);
				return () => {
					liveEventHandlers.delete(handler);
				};
			} },
			state: {
				get sessionManager() {
					return session.sessionManager;
				},
				get cwd() {
					return session.sessionManager.getCwd();
				},
				isIdle() {
					return !session.isStreaming;
				},
				hasPendingMessages() {
					return pendingMessageCount > 0;
				},
				getAvailableModels() {
					return session.modelRegistry.getAvailable();
				},
				getCurrentModel() {
					return session.model;
				},
				getThinkingLevel() {
					return session.thinkingLevel;
				},
				getContextUsage() {
					return session.getContextUsage() ?? null;
				}
			},
			actions: {
				sendUserMessage(content, options) {
					session.sendUserMessage(content, { deliverAs: options.deliverAs });
				},
				abort() {
					session.abort();
				},
				async setModel(model) {
					const previousModel = session.model;
					await session.setModel(model);
					if (!session.model) return;
					emitLiveEvent({
						type: "model_select",
						model: session.model,
						previousModel,
						source: "set"
					});
				},
				setThinkingLevel(level) {
					session.setThinkingLevel(level);
				},
				setSessionName(name) {
					session.setSessionName(name);
				},
				getCommands() {
					return listSessionCommands(session);
				}
			}
		},
		session,
		async dispose() {
			unsubscribeSession();
			session.dispose();
		}
	};
}
async function createStandaloneBridgeContext(options = {}) {
	const cwd = options.cwd?.trim() || process.cwd();
	const sessionManager = options.sessionPath ? SessionManager.open(options.sessionPath) : SessionManager.create(cwd, options.sessionDir);
	const result = await createDetachedAgentSession(sessionManager.getCwd() || cwd, sessionManager);
	await result.session.bindExtensions({
		uiContext: createHeadlessUIContext(),
		onError: (error) => {
			console.error(`Standalone bridge extension error (${error.extensionPath}):`, error.error);
		},
		shutdownHandler: () => {}
	});
	return createStandaloneBridgeContextFromSession(result.session);
}
//#endregion
export { createStandaloneBridgeContext, createStandaloneBridgeContextFromSession };
