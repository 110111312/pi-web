import { createDetachedAgentSession } from "./detached-session.js";
import { createHeadlessUIContext } from "./headless-ui-context.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
//#region src/session-registry.ts
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
export { DetachedSessionHandle, DetachedSessionRegistry };
