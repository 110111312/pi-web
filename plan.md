# Implementation Plan

## Goal
When `pi --web` is invoked, start the bridge server headlessly (no TUI main loop). The user sees a bridge status view in the terminal and interacts entirely through the browser. Ctrl+C stops the bridge and exits pi.

## Background

### Current flow (`pi --web`)
1. `main.js` parses args → `--web` goes into `parsed.unknownFlags` → `extensionFlagValues`
2. `resolveAppMode()` returns `"interactive"` (extension flags don't affect mode selection)
3. `InteractiveMode.run()` → `init()` starts the TUI (`this.ui.start()`)
4. `bindCurrentSessionExtensions()` → `bindExtensions()` → emits `session_start`
5. Our `session_start` handler fires, calls `autoStartWebBridge()` which starts the bridge
6. `bindExtensions()` returns → `init()` finishes → TUI enters main input loop
7. User is "inside pi" with the bridge running in the background

### Key upstream constraint
The `session_start` event is **awaited** by `bindExtensions()`:
```js
async bindExtensions(bindings) {
    ...
    await this._extensionRunner.emit(this._sessionStartEvent);  // blocks until all handlers return
    await this.extendResourcesFromExtensions(...);
}
```

`bindExtensions()` is called from `bindCurrentSessionExtensions()`, which is called from `init()`, which is called from `run()`. If the `session_start` handler **never returns**, `bindExtensions()` never completes, `init()` never finishes, and `run()` never enters the main input loop.

The TUI is already initialized (`this.ui.start()` runs before `bindCurrentSessionExtensions()`), but the main editor/input loop never starts.

### How `ctx.shutdown()` works
`ctx.shutdown()` calls `shutdownHandler()` which sets `shutdownRequested = true` and calls `void this.shutdown()`. `this.shutdown()` is async — it stops the TUI (`this.stop()`), disposes the runtime (`this.runtimeHost.dispose()` which emits `session_shutdown`), and calls `process.exit(0)`.

Since `this.shutdown()` is fire-and-forget (`void`), `ctx.shutdown()` returns immediately. The process exits when `this.shutdown()` reaches `process.exit(0)`.

### Approach: Block in `session_start` + take over TUI with `ctx.ui.custom()`

1. `session_start` handler detects `--web` flag
2. Starts the bridge (reuses existing `autoStartWebBridge` logic)
3. Calls `ctx.ui.custom()` to replace the TUI editor with a simple "bridge running" status view
4. Blocks inside the custom view until the user exits (Ctrl+C / Q)
5. Stops the bridge, calls `ctx.shutdown()`, then blocks forever (`await new Promise(() => {})`) to prevent `bindExtensions()` from returning
6. `this.shutdown()` (triggered by `ctx.shutdown()`) calls `process.exit(0)`, killing the blocked promise

## Tasks

1. **Create `runHeadlessWebMode` function**
   - File: `packages/bin/src/index.ts`
   - Changes: New async function that:
     - Takes `(pi: ExtensionAPI, ctx: ExtensionContext, bridge: BridgeController)`
     - Uses `ctx.ui.custom()` to show a status view with the bridge URL and "Press Ctrl+C to quit"
     - Registers `process.stdin` exit handler (same pattern as `runBridgeTerminalView`) to detect Ctrl+C/Q
     - Registers `SIGINT`/`SIGTERM` handlers that stop the bridge
     - Blocks inside `ctx.ui.custom()` until `done()` is called
     - After `ctx.ui.custom()` returns: stops bridge, calls `ctx.shutdown()`, then `await new Promise(() => {})` to block forever (prevents `bindExtensions` from returning; `process.exit(0)` from `this.shutdown()` will kill it)
   - Acceptance: Function blocks until bridge stops, then triggers pi shutdown

2. **Modify `session_start` handler for headless mode**
   - File: `packages/bin/src/index.ts`
   - Changes: In the `pi.on("session_start", ...)` handler:
     - When `pi.getFlag("web") === true` and `event.reason === "startup"`:
       - Call `autoStartWebBridge(pi, ctx)` to start the bridge (existing function, returns `BridgeController`)
       - If bridge started successfully, call `await runHeadlessWebMode(pi, ctx, bridge)` — this blocks the handler
       - If bridge failed, log error and return (falls through to normal TUI)
     - Remove the old non-headless auto-start behavior (the handler used to start the bridge and return, letting TUI continue)
   - Acceptance: `pi --web` blocks at the custom view, TUI main loop never starts

3. **Update `autoStartWebBridge` — remove the "TUI remains interactive" message**
   - File: `packages/bin/src/index.ts`
   - Changes: In `autoStartWebBridge`, remove the `console.log("[pi-web] TUI remains interactive...")` line since the TUI is no longer interactive in `--web` mode. The bridge URL and WebSocket URL logs remain.
   - Acceptance: No misleading "TUI remains interactive" message

4. **Keep `/web` command working without `--web`**
   - File: `packages/bin/src/index.ts`
   - Changes: The `webBridgeHandler` already checks `autoStartedBridge` for reuse. When `--web` is NOT used, `autoStartedBridge` is `undefined`, so `/web` starts a fresh bridge as before. When `--web` IS used, the `session_start` handler blocks forever, so `/web` is never reachable. No changes needed to `webBridgeHandler`, but the `autoStartedBridge` reuse path becomes effectively dead code for `--web` mode (harmless to keep).
   - Acceptance: `pi` (without `--web`) + `/web` still works normally

5. **Keep `session_shutdown` handler for cleanup**
   - File: `packages/bin/src/index.ts`
   - Changes: The existing `session_shutdown` handler stops `autoStartedBridge` if set. In headless mode, the bridge is already stopped before `ctx.shutdown()` fires, so the handler is a no-op (idempotent `stop()`). No changes needed.
   - Acceptance: No double-stop errors on shutdown

6. **Update `--web` flag description**
   - File: `packages/bin/src/index.ts`
   - Changes: Change the flag description from "Start the web bridge server automatically alongside the TUI" to "Start the web bridge server (headless, no TUI)". Reflects the new headless behavior.
   - Acceptance: `pi --help` shows updated description

7. **Update `web-flag.test.ts` tests**
   - File: `packages/bin/src/__tests__/web-flag.test.ts`
   - Changes: 
     - The test "DOES start the bridge when --web is true and reason is 'startup'" needs to verify the headless path is triggered (bridge starts, `ctx.ui.custom` is called)
     - The mock `ExtensionContext` needs `ui.custom` to be a mock that resolves immediately (or captures the callback for inspection)
     - The test "returns the same controller on repeated autoStartWebBridge calls" should still work since `autoStartWebBridge` is unchanged
     - Add a test that verifies `ctx.shutdown()` is called after the bridge stops
   - Acceptance: `pnpm test` passes

8. **Build, deploy, and verify**
   - Commands: `pnpm run check && pnpm test && pnpm run build:bin && pnpm run build:web`
   - Deploy: `pi install /Users/encap/Desktop/Dev/pi-web` + copy `web-dist/` and `dist/bin/index.js` to installed location
   - Manual verify: `pi --web` should show bridge URL in terminal, not the TUI editor. Ctrl+C should exit cleanly.
   - Acceptance: `pi --web` shows only bridge URL, no TUI editor

## Files to Modify
- `packages/bin/src/index.ts` — add `runHeadlessWebMode`, modify `session_start` handler to block in headless mode, update flag description, update `autoStartWebBridge` message
- `packages/bin/src/__tests__/web-flag.test.ts` — update tests for headless behavior

## New Files
- None

## Dependencies
- Task 1 → Task 2 (headless mode function exists before handler uses it)
- Tasks 1+2 → Task 3 (message update is trivial, after core logic)
- Tasks 1+2 → Task 7 (tests exercise the new code)
- All → Task 8 (build and deploy last)

## Risks

1. **`ctx.ui.custom()` availability in `session_start`**: The UI context is set before `session_start` is emitted (confirmed in `bindExtensions` source: `this._extensionUIContext = bindings.uiContext` before `emit`). However, the TUI has just been initialized — the custom view should work since `this.ui.start()` already ran. Need to verify the custom view renders correctly during `init()`.

2. **Race between `ctx.shutdown()` and `bindExtensions()` returning**: `ctx.shutdown()` calls `void this.shutdown()` (fire-and-forget). The `session_start` handler then blocks on `await new Promise(() => {})`. If `this.shutdown()` runs fast enough, `process.exit(0)` kills the process before `bindExtensions` returns. If it's slow, `bindExtensions` might return and `init()` might continue briefly. The `await new Promise(() => {})` prevents this. The risk is low but should be verified.

3. **SIGINT handling during custom view**: The TUI may intercept Ctrl+C. The `process.stdin` handler and the custom view's `handleInput` both check for exit input. The bridge is started with `captureSigint: false`, so the bridge doesn't handle SIGINT. We register our own SIGINT handler. Need to verify Ctrl+C works from the custom view.

4. **`ctx.shutdown()` when session is streaming**: `shutdownHandler` checks `if (!this.session.isStreaming)` before calling `this.shutdown()`. At `session_start` with `reason: "startup"`, the session should not be streaming. If for some reason it is, `shutdownRequested` is set but `this.shutdown()` isn't called — the process won't exit. Mitigation: also register a `SIGTERM`/`SIGINT` handler that calls `process.exit(0)` as a fallback.

5. **Pre-existing integration test failures**: 3 tests in `packages/bin/src/__tests__/integration.test.ts` fail on clean main. These are unrelated to this change.

6. **The `autoStartedBridge` reuse path in `webBridgeHandler`**: When `--web` is headless, the user never reaches `/web`, so the reuse path is dead code. It's harmless but could be confusing. Consider adding a comment or removing it in a follow-up.