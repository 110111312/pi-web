# Known Issues

A running list of known issues / quirks discovered during development. Each entry
should describe the symptom, reproduction, current workaround (if any), and
hypothesis. This file is intentionally lightweight — for full bug reports, use
GitHub issues.

## Slash command palette: `/reload` appears with pi's built-in description

**Status:** unresolved / under investigation (performance not affected).

**Symptom.** When typing `/` in the web UI composer, the slash command palette
shows a `/reload` entry with description
"Reload keybindings, extensions, skills, prompts, and themes" — which is the
exact description of pi's TUI built-in command (see
`@earendil-works/pi-coding-agent/dist/core/slash-commands.js`). Submitting it
sends the literal text `/reload` to the LLM (no client-side intercept, no RPC
handler).

**Reproduction.**
1. `pi-web` installed as a pi package (via `pi install ~/Desktop/Dev/pi-web`).
2. Open the web UI.
3. Type `/` in the composer.

**Where it should come from.** The web UI's slash palette is built from:
- `props.commands` — populated by the bridge's `get_commands` RPC, which in
  turn calls `pi.getCommands()` → `ExtensionRunner.getRegisteredCommands()`.
  This returns only extension-registered slash commands.
- `BUILTIN_SLASH_COMMANDS` in
  `packages/svelte/src/utils/slashCommands.ts`, which currently only contains
  `compact` (hardcoded client-side).

Neither path includes pi's `BUILTIN_SLASH_COMMANDS` (the
"reload"/"settings"/"model"/... set), so the entry should not appear.

**Hypotheses (none confirmed).**
- The installed bridge dist is byte-identical to the current repo build
  (`diff -q` is clean) and contains no `BUILTIN_SLASH_COMMANDS` references.
- A newer version of `pi-coding-agent` may return built-in commands from
  `getCommands()`; the locally installed version does not.
- A loaded extension may register a `reload` command. None of the user's
  global extensions (`~/.pi/agent/extensions/`) do, and the bridge extension
  itself only registers `web`.
- Stale browser state has been ruled out (hard refresh + pi restart both
  tried; symptom persists).

**Debug steps for next time.**
1. Open browser DevTools → Network → WS tab.
2. Inspect the `get_commands` response payload.
3. If `reload` is in the response, the source is server-side (extend
   investigation into `listSessionCommands` and
   `ExtensionRunner.getRegisteredCommands`).
4. If `reload` is NOT in the response, the web UI is using stale store
   state — investigate `_commands` in
   `packages/svelte/src/composables/bridgeStore.svelte.ts` (line ~300,
   ~2275).

**Workaround.** None needed for functionality — the entry is inert and
submitting it just sends the text to the LLM. If the user wants
`/reload` to actually trigger a reload, the underlying bridge would need a
`reload` RPC + live-session action (not currently implemented — see
reverted design from earlier in this session).

## New session: model display desyncs from prompt model

**Status:** bug confirmed, fix not yet applied.

**Symptom.** After pressing "New session" (in the workspace sidebar, via
`/new`, or via the `newSession` flow), the composer header shows the
previous live session's model (e.g. `minimax-m3`). When the user submits a
prompt, the request actually goes to the new session's default model
(e.g. `glm-5.2`). Model display and actual request model are out of sync
until the user manually re-selects a model.

**Reproduction.**
1. Open the web UI attached to a live pi session with model `minimax-m3`.
2. Press the workspace "New session" button (or `/new`).
3. Without re-selecting a model, type a prompt and submit.
4. Watch the network/devtools: the request goes to `glm-5.2`.

**Root cause.** In `packages/svelte/src/composables/bridgeStore.svelte.ts`,
the `case "new_session"` response handler (around line 2244) does **not**
call `sendCommand({ type: "get_state" })` to refresh client-side state
from the new session. The companion `case "switch_session"` handler does
(this is why switching to a stored session displays the right model).
Because `_currentModel` and `_sessionState.model` are not refreshed, the
header keeps showing the live session's model. Meanwhile the new detached
session created by the bridge uses its own default model
(`AgentSession` default from pi), so subsequent `prompt` RPCs hit that.

**Affected paths.**
- Explicit "New session" button → `newSession()` RPC → `case "new_session"` handler.
- `prompt` RPC with no detached session selected (auto-create path in
  `ws-rpc-adapter.ts` ~line 4724) — the `prompt` handler returns a
  synthetic `new_session` response, which goes through the same buggy
  handler. So even a user who never explicitly clicks "New session" can
  hit this if the bridge is in a state with no detached selection and they
  send a message.

**Proposed fix.** Mirror the `switch_session` handler: pass
`{ refreshState: true }` to `applySessionSnapshotResponse` (or add an
explicit `sendCommand({ type: "get_state" })` after the snapshot apply).
This will pull the new session's model, thinking level, etc. into
`_sessionState` and `_currentModel`.

**Workaround.** Manually re-select a model in the model picker after
pressing New session. The model picker in the composer header is bound to
`_currentModel` and `set_model` calls go to the currently selected
detached session, so re-selecting the displayed model will re-set it on
the new session and align the two. *(Fixed: `case "new_session"` now
passes `{ refreshState: true }` to `applySessionSnapshotResponse` to
mirror `case "switch_session"`.)*

## New session not visible in sidebar without refresh

**Status:** bug confirmed, fix applied.

**Symptom.** After pressing "New session", the new session does NOT appear
in the workspace's session list in the sidebar until the user refreshes
the web UI.

**Reproduction.**
1. Open the web UI.
2. Press "New session".
3. Look at the sidebar — the new session is missing until refresh.

**Root cause.** In `packages/bridge/src/ws-rpc-adapter.ts`, the
`appendSessionManager` helper (used inside `case "list_sessions"`)
returned early when `fs.existsSync(sessionPath)` was false. The bridge
creates a new session in memory via `SessionManager.create(cwd, ...)`,
which sets the session file path but does not flush the header to disk
until messages are written. So immediately after `new_session`, the file
does not exist on disk, the cached manager was skipped, and the new
session was invisible to the sidebar's `list_sessions` response. The
fix: pass `requireOnDisk: false` for the cached-detached-managers loop
in `case "list_sessions"` so the in-memory header is used. Disk-backed
callers (the live-session manager, the `listWorkspaceSessionFiles` loop)
keep the existing `fs.existsSync` check.

**Affected paths.** All `new_session` flows, including the auto-create
path inside `case "prompt"` (which returns a synthetic `new_session`
response when no detached session is selected).

**Workaround (before fix).** Refresh the web UI.

## Slash command palette: skills from project .pi/settings.json not visible

**Status:** under investigation.

**Symptom.** Project skills (e.g. `/skill:odoo-rpc` from `.claude/skills/
mapped via `.pi/settings.json`) don't appear in the web UI's slash command
palette. Extension commands (like `/web`) and built-ins (like `/compact`)
work fine.

**Reproduction.**
1. Start pi in a project with skills (e.g. `odoo/en-erp` with `.pi/settings.json`
   mapping `../.claude/skills`).
2. Open the web UI.
3. Type `/` in the composer — no `skill:` entries appear.

**Root cause.** The data flow is: `pi.getCommands()` → `AgentSession.getCommands()`
→ includes `this._resourceLoader.getSkills().skills` → maps to `skill:<name>`.
The bridge extension calls `pi.getCommands()` via `ExtensionAPI.getCommands()`,
which goes through `ExtensionRuntime.getCommands()` →
`actions.getCommands` (the `AgentSession` closure). The `ws-rpc-adapter`
now correctly preserves the `source` field. The client re-fetches
`get_commands` after `agent_end`.

**Possible remaining gaps:**
- The initial `get_commands` call may fire before pi's resource loader has
  finished loading project skills (race condition on startup).
- The `ExtensionRuntime.assertActive()` check may prevent `getCommands()`
  from being called in certain states.
- Verify in DevTools → Network → WS tab: look at the `get_commands`
  response payload. If `skill:` entries are present, the issue is
  client-side. If absent, the issue is server-side (pi's resource loader
  hasn't loaded skills yet, or the extension API doesn't expose them).
