# Code Context: Branch session files in sidebar (parentSession filtering)

## Executive Summary

**Branch sessions DO appear in the sidebar because `list_sessions` returns every top-level `.jsonl` file in the workspace session directory without filtering by `parentSession`.** pi's `SessionManager` exposes `parentSession` on the file header (sessions 0x...b6 and 0x...bb in the live dataset have `parentSession` pointing to the 0x...a0 "improvements" root), but the bridge's `readSessionFileHeader` / `readWorkspaceSessionSummary` only reads `id`, `timestamp`, and `cwd` — the `parentSession` field is never inspected, so forked sessions are surfaced as ordinary top-level entries.

The branches come from the web UI's `fork` RPC handler (`ws-rpc-adapter.ts:5403-5433`), which calls `SessionManager.createBranchedSession(entryId)`. That SDK method writes a brand-new `.jsonl` file with `parentSession: <previousSessionFile>` and `_rewriteFile()`s it to disk synchronously. Once flushed, it shows up in both `listWorkspaceSessionFiles()` (disk scan) and `getCachedSessionManagers()` (registry).

The right sidebar (`SessionTreeRail.svelte`) already provides in-session tree navigation, so per the user, the **left sidebar should only show one entry per tree** — i.e. filter out any `.jsonl` whose header carries a `parentSession` that points to another session within the same workspace. Subagent sessions (the `<sessionId>/<subagentId>/run-0/session.jsonl` directories) are NOT being picked up — `listSessionFilesInDir` uses non-recursive `readdirSync`.

The recent `requireOnDisk: false` change (`0ee7bb8`) is **not** the cause of branch entries appearing — those files exist on disk. It only affects not-yet-flushed brand-new sessions (`new_session` RPC), which is unrelated to the branch fork path.

---

## Files Retrieved

1. `packages/bridge/src/ws-rpc-adapter.ts:5687-5840` — `list_sessions` handler (the bug site)
2. `packages/bridge/src/ws-rpc-adapter.ts:5726-5762` — `appendSessionManager` helper (recent `requireOnDisk: false` change)
3. `packages/bridge/src/ws-rpc-adapter.ts:5763-5786` — disk-scan + cached-managers fan-out
4. `packages/bridge/src/ws-rpc-adapter.ts:519-528` — `listSessionFilesInDir` (non-recursive)
5. `packages/bridge/src/ws-rpc-adapter.ts:993-1013` — `readSessionFileHeader` (drops `parentSession`)
6. `packages/bridge/src/ws-rpc-adapter.ts:1018-1041` — `readWorkspaceSessionSummary` (no branch filter)
7. `packages/bridge/src/ws-rpc-adapter.ts:5403-5433` — `fork` RPC → `createBranchedSession` (source of the branch files)
8. `packages/bridge/src/ws-rpc-adapter.ts:729-755` — `readWorkspaceUpdatedAt` (walks every file including branches)
9. `packages/bridge/src/ws-rpc-adapter.ts:162-174` — `WorkspaceSessionEntry` interface (no `parentSession` field)
10. `packages/bridge/src/ws-rpc-adapter.ts:190-197` — `SessionListManager` interface (no `parentSession` in `getHeader`)
11. `packages/bridge/src/session-registry.ts:160-200` — `DetachedSessionRegistry.openSession` / `getCachedSessionManagers`
12. `packages/bridge/src/session-registry.ts:217-219` — `getCachedSessionManagers` returns all handles' managers
13. `packages/bridge/src/detached-session.ts:13-50` — `createDetachedAgentSession` (no branch logic)
14. `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:884-947` — `createBranchedSession` (writes new file with `parentSession`)
15. `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:1013-1047` — `static forkFrom` (also writes `parentSession` header)
16. `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:770-780` — `getHeader()` returns the full header entry (includes `parentSession`)
17. `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:324-385` — `buildSessionInfo` (does parse `parentSession` as `parentSessionPath`, but `listSessionsFromDir` does not filter on it)
18. `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:391-415` — `listSessionsFromDir` (returns every `.jsonl` it finds)
19. `packages/svelte/src/components/SessionTreeRail.svelte:1-100` — right-sidebar tree of entries within ONE session (does not need to show cross-session branches)
20. `packages/svelte/src/components/SessionRail.svelte:120-150` — left-sidebar sorts/dedupes by `path`, no branch filter
21. `packages/svelte/src/composables/bridgeStore.svelte.ts:76-88` — `SessionEntry` interface (no `parentSession` field exposed to UI)
22. `packages/svelte/src/composables/bridgeStore.svelte.ts:1925-1950` — `loadWorkspaceSessions` sends `includeActive: true`
23. `packages/bridge/src/__tests__/ws-rpc-adapter.test.ts:2620-2800` — existing `list_sessions` tests (no parentSession coverage)

---

## Live dataset inspection (concrete proof)

`/Users/encap/.pi/agent/sessions/--Users-encap-Desktop-Dev-pi-web--/`:

```
2026-06-22T02-37-27-545Z_019eed30...  (no parentSession)        name="improvements"     mtime Jun 24 15:55
2026-06-23T03-55-07-904Z_019ef29e...  (no parentSession)        name="glm-5.2 context"  mtime Jun 23 11:26
2026-06-24T08-19-53-511Z_019ef8b6...  parentSession=...a0.jsonl name="improvements"     mtime Jun 24 15:24  ← BRANCH
2026-06-24T08-24-56-560Z_019ef8bb...  parentSession=...a0.jsonl name="improvements"     mtime Jun 24 15:35  ← BRANCH
2026-06-24T08-37-25-384Z_019ef8c6...  (no parentSession)        name="extensions"       mtime Jun 24 15:37
2026-06-24T08-37-42-306Z_019ef8c7...  (no parentSession)        name="extensions"       mtime Jun 24 15:37
```

`2026-06-22T02-37-27-545Z_019eed30.../` is a sibling **directory** alongside the file — it contains the subagent session trees (`00a873e4/run-0/session.jsonl`, etc.) and `subagent-artifacts/`. These are **not** picked up by the sidebar (non-recursive `readdirSync` at `listSessionFilesInDir`, `ws-rpc-adapter.ts:519-528`).

The 2 entries with `parentSession` set are the ones the user is seeing as "duplicates". The user has 3 main sessions × 2 branches of one main = 6 total entries in the left sidebar.

---

## Key Code

### 1. Bridge's `list_sessions` — no `parentSession` filter

`packages/bridge/src/ws-rpc-adapter.ts:5687-5762`:

```ts
case "list_sessions": {
  ...
  const sessions: WorkspaceSessionEntry[] = [];
  const seenSessionPaths = new Set<string>();
  ...
  for (const sessionPath of listWorkspaceSessionFiles(workspacePath)) {
    appendSession(
      readWorkspaceSessionSummary(
        sessionPath,
        sessionPath === liveSessionFile ? !this.context.state.isIdle() : ...,
      ),
    );
  }
  if (command.includeActive !== false) {
    appendSessionManager(this.context.state.sessionManager, liveSessionFile, ...);
    for (const sessionManager of this.sessionRuntime.getCachedSessionManagers()) {
      appendSessionManager(
        sessionManager,
        sessionManager.getSessionFile(),
        this.context.state.cwd,
        { requireOnDisk: false },   // ← recent change
      );
    }
  }
  ...
}
```

The dedup is by `session.path` only. There is **no inspection of `parentSession`** anywhere in the fan-out.

### 2. `readSessionFileHeader` discards `parentSession`

`packages/bridge/src/ws-rpc-adapter.ts:993-1013`:

```ts
function readSessionFileHeader(sessionPath: string): {
  id: string;
  timestamp?: string;
  cwd?: string;
} | null {
  const prefix = readSessionFilePrefix(sessionPath);
  const firstLine = prefix.split("\n", 1)[0];
  const header = parseJsonLine(firstLine) as {
    id?: unknown; timestamp?: unknown; cwd?: unknown; type?: unknown;
  } | null;
  if (header?.type !== "session" || typeof header.id !== "string") return null;
  return {
    id: header.id,
    timestamp: typeof header.timestamp === "string" ? header.timestamp : undefined,
    cwd: typeof header.cwd === "string" ? header.cwd : undefined,
  };
}
```

The header is the same JSON entry that has `parentSession` (visible in the disk file), but the bridge narrows to three fields and drops everything else.

### 3. `listSessionFilesInDir` is non-recursive — subagent dirs are safe

`packages/bridge/src/ws-rpc-adapter.ts:519-528`:

```ts
function listSessionFilesInDir(sessionDir: string): string[] {
  try {
    return fs
      .readdirSync(sessionDir)
      .filter(file => file.endsWith(".jsonl"))
      .map(file => path.join(sessionDir, file));
  } catch {
    return [];
  }
}
```

Only top-level `.jsonl` files are returned. Subagent files like `…/2026-06-22…/00a873e4/run-0/session.jsonl` are not enumerated.

### 4. SDK `createBranchedSession` — what generates the branch files

`node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:884-947`:

```js
createBranchedSession(leafId) {
    const previousSessionFile = this.sessionFile;
    const path = this.getBranch(leafId);
    if (path.length === 0) throw new Error(`Entry ${leafId} not found`);
    const pathWithoutLabels = path.filter((e) => e.type !== "label");
    const newSessionId = createSessionId();
    const timestamp = new Date().toISOString();
    const fileTimestamp = timestamp.replace(/[:.]/g, "-");
    const newSessionFile = join(this.getSessionDir(), `${fileTimestamp}_${newSessionId}.jsonl`);
    const header = {
        type: "session",
        version: CURRENT_SESSION_VERSION,
        id: newSessionId,
        timestamp,
        cwd: this.cwd,
        parentSession: this.persist ? previousSessionFile : undefined,   // ← key field
    };
    ...
    const hasAssistant = this.fileEntries.some((e) => e.type === "message" && e.message.role === "assistant");
    if (hasAssistant) {
        this._rewriteFile();   // ← synchronous write to disk
        this.flushed = true;
    }
    ...
    return newSessionFile;
}
```

The `fork` RPC at `ws-rpc-adapter.ts:5403-5433` calls exactly this method:

```ts
case "fork": {
  const currentSessionFile = this.sessionRuntime.currentTranscriptSessionPath()
                              ?? this.context.state.sessionManager.getSessionFile();
  ...
  const sourceSm = openSessionManager(currentSessionFile);
  const newSessionPath = sourceSm.createBranchedSession(command.entryId);
  ...
  const selected = await this.sessionRuntime.switchToStoredSession(newSessionPath);
  ...
}
```

`switchToStoredSession` → `registry.openSession(newSessionPath)` adds the new path to `handles` — so the next `list_sessions` will see it via both the disk scan **and** `getCachedSessionManagers()`.

### 5. SDK `getHeader()` already returns the full header entry

`node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:770-780`:

```js
getHeader() {
    const h = this.fileEntries.find((e) => e.type === "session");
    return h ? h : null;
}
```

The actual return type is the **full** session entry, including `parentSession`. The bridge's `SessionListManager` interface at `ws-rpc-adapter.ts:190-197` narrows this to `{ id; timestamp; cwd? }`, losing the field. Two ways to expose it: widen the interface, or use the SDK's `list(cwd, sessionDir)` which already returns `parentSessionPath` (`session-manager.js:324-385`, `buildSessionInfo`).

### 6. SDK `list` / `listSessionsFromDir` do NOT filter — they return everything

`node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:391-415`:

```js
async function listSessionsFromDir(dir, onProgress, progressOffset = 0, progressTotal) {
    ...
    const files = dirEntries.filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));
    ...
    for (const info of results) {
        if (info) sessions.push(info);
    }
    ...
    return sessions;
}
```

`buildSessionInfo` already parses `parentSessionPath` into the result object — but neither `list()` nor `listAll()` filter on it. The filtering is a consumer responsibility (in this case: the bridge).

### 7. `DetachedSessionRegistry.getCachedSessionManagers`

`packages/bridge/src/session-registry.ts:217-219`:

```ts
getCachedSessionManagers(): SessionManager[] {
    return [...this.handles.values()].map(handle => handle.getSessionManager());
}
```

Returns every manager the registry has opened (via `openSession` or `createSession`). After a `fork`, the new file is in there. After an in-memory `new_session` (the case the `requireOnDisk: false` change targets), the file may NOT be on disk yet — and the recent change makes that show up anyway. Both paths are correctly handled by the existing dedup against `seenSessionPaths` plus the `appendSession` workspace check.

### 8. The `requireOnDisk: false` change is NOT the cause of branch duplicates

`packages/bridge/src/ws-rpc-adapter.ts:5726-5762` and the diff in `0ee7bb8` show the change only affects the **cached-managers** loop, where the manager's file may not yet exist on disk. Branch files (created by `createBranchedSession`) ARE written to disk synchronously — so they are picked up by the earlier `listWorkspaceSessionFiles` loop regardless of the `requireOnDisk` flag. The branch entries are visible even if you set `requireOnDisk: true` on the cached-managers loop.

What the `requireOnDisk: false` change did add (orthogonal): a freshly-`new_session`'d session (file path set in memory, header not yet flushed) will now appear in the sidebar immediately rather than after the first assistant turn writes the file. This is a side benefit, not the bug source.

### 9. Svelte `SessionEntry` (the type the UI renders) has no `parentSession`

`packages/svelte/src/composables/bridgeStore.svelte.ts:76-88`:

```ts
export interface SessionEntry {
  id: string;
  name: string;
  path: string;
  isRunning?: boolean;
  timestamp?: string;
  updatedAt?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspacePath?: string;
}
```

No field. The right-sidebar `SessionTreeRail.svelte` renders the in-session tree (entries within one file), not cross-session branches. So the filtering should happen in the bridge (server) and just produce a smaller `sessions[]` for the UI.

---

## Architecture

- **Storage layout** (`~/.pi/agent/sessions/--Users-encap-Desktop-Dev-pi-web--/`):
  - top-level `<timestamp>_<id>.jsonl` files — one per session, including branches. Branch files have a `parentSession` header field pointing to the source file.
  - `<timestamp>_<id>/` sibling directory holding subagent sessions and `subagent-artifacts/`. These are NOT visible to the sidebar scan.
  - The `subagent-artifacts/` top-level dir is also ignored by the disk scan.
- **Source of branch files**: the bridge's `fork` RPC → `SessionManager.createBranchedSession`. The fork flow also calls `switchToStoredSession`, which adds the new path to `DetachedSessionRegistry.handles`.
- **Source of "main" sessions**: the live TUI session's `context.state.sessionManager` (plus any sessions the user has explicitly opened/created via the UI).
- **`list_sessions` flow**:
  1. `listWorkspaceSessionFiles(workspacePath)` → `listSessionFilesInDir` (non-recursive `readdirSync`).
  2. For each path, `readWorkspaceSessionSummary` → `readSessionFileHeader` → returns `{id, timestamp, cwd}` only. **`parentSession` is dropped.**
  3. Live session is added via `appendSessionManager(this.context.state.sessionManager, …)`.
  4. All cached detached managers are added via `appendSessionManager(…, {requireOnDisk: false})`.
  5. Dedup by `session.path` (via `appendSession` → `seenSessionPaths`).
  6. Sort by activity, paginate, return.
- **Filtering gap**: step 1/2 doesn't know that some files are branches of others. The dedup by `path` doesn't help because each branch is a unique file. The result is N+1 sidebar rows for N branches of one root.

---

## Recommended fix (high-level)

Two viable options, in order of preference:

**Option A — Bridge-side filter, no API change**
Inside `case "list_sessions"` in `ws-rpc-adapter.ts`, after collecting `sessions[]`, drop any entry whose file header's `parentSession` points to another file that also exists in the same workspace dir.

Implementation sketch:

```ts
// Once after the loop, build set of workspace paths:
const workspacePathSet = new Set(
  listWorkspaceSessionFiles(workspacePath)
);

function isBranchEntry(entry: WorkspaceSessionEntry): boolean {
  const header = readSessionFileHeader(entry.path);
  const parent = header?.parentSession; // need to add this field
  if (!parent) return false;
  // If the parent also lives in this workspace dir, this is a branch
  return workspacePathSet.has(parent);
}

const filtered = sessions.filter(s => !isBranchEntry(s));
```

The catch: `readSessionFileHeader` currently doesn't return `parentSession`. Need to widen it (and probably the `SessionListManager.getHeader` return type too, since the cached-managers loop will need to consult it for in-memory branches). See `ws-rpc-adapter.ts:993-1013` and `ws-rpc-adapter.ts:190-197`.

**Option B — Use the SDK's `SessionManager.list()` instead**

`SessionManager.list(cwd, sessionDir, onProgress)` returns rows with `parentSessionPath` already populated (`session-manager.js:1057`). The bridge could replace `listWorkspaceSessionFiles` + `readWorkspaceSessionSummary` with a single SDK call, then filter rows whose `parentSessionPath` is in the same directory.

Cons: introduces async I/O via the SDK; current code is sync; would need a wider refactor of `readWorkspaceUpdatedAt` and other callers that share `listWorkspaceSessionFiles`.

**Recommendation: Option A** — minimal-blast-radius change confined to `list_sessions`. Also keep the active `parentSession` (if the user has switched INTO a branch session via the file picker) visible — they may have explicitly chosen it. Concretely: filter out branches whose parent is in the workspace, but never filter out the `liveSessionFile` or the `currentTranscriptSessionPath`.

### Files to change (Option A)

- `packages/bridge/src/ws-rpc-adapter.ts`:
  - `readSessionFileHeader` (`ws-rpc-adapter.ts:993-1013`): add `parentSession?: string` to the return type.
  - `SessionListManager` interface (`ws-rpc-adapter.ts:190-197`): widen `getHeader` return type to include `parentSession`.
  - `appendSessionManager` (`ws-rpc-adapter.ts:5726-5762`): include `parentSession` on the constructed `WorkspaceSessionEntry` (only when not the live one — and only for the cache-side path; for `readWorkspaceSessionSummary` it's already cheap to add since we have the header).
  - `WorkspaceSessionEntry` interface (`ws-rpc-adapter.ts:162-174`): add `parentSession?: string`.
  - `list_sessions` handler (`ws-rpc-adapter.ts:5687-5840`): after building the `sessions[]` array, filter out entries whose `parentSession` is in the same workspace dir, **except** for the live session / currently-selected session.
- `packages/svelte/src/composables/bridgeStore.svelte.ts:76-88`: add `parentSession?: string` to `SessionEntry` (optional — the UI doesn't need to use it, but the type should reflect the wire shape).

### Tests to add

- `packages/bridge/src/__tests__/ws-rpc-adapter.test.ts`: a test that creates a branch via `createBranchedSession` and asserts `list_sessions` returns only the parent.
- Same file: a test that asserts the currently-active branch session is still in the result even if it has a `parentSession` header (so the user can still navigate to a branch they previously opened).

---

## Start Here

Open `packages/bridge/src/ws-rpc-adapter.ts` at line **5687** (`case "list_sessions"`) and trace the `sessions[]` array through lines 5763-5786. The fix is a post-loop filter against a workspace-scoped `Set` of parent paths. The `readSessionFileHeader` widening at line 993 is the only structural change needed upstream of that loop.
