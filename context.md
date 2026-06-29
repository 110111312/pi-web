# Code Context — Diff file viewing bug (wrong workspace root)

## Bug Summary

When the user picks a nested repo (e.g. `en-erp`) from the composer bar's
branch dropdown, `bridge.diffEntries` is correctly populated for that repo.
But clicking an entry to view the file uses the active session's
`workspacePath` (the outer `odoo` root) when calling `read_workspace_file`,
so the bridge resolves the relative diff path against the wrong root and
returns "file does not exist".

The diff entry is relative to the selected repo root, not the active
session's cwd, but that root is currently dropped between the bridge
response and the file viewer.

---

## Files Retrieved

1. `packages/svelte/src/App.svelte` (lines 1–1612, 1613–1760)
   - Why: contains `selectedGitRepoRoot` state, `openFileDiffViewer`,
     `readDisplayedWorkspaceFile`, and the chain that hands the diff entry
     to the file viewer modal.
2. `packages/svelte/src/components/GitPanel.svelte` (lines 1–266)
   - Why: renders diff entries, calls `onOpenFileDiff(entry)` on click.
     Note: it no longer knows which repo the entries belong to (the repo
     selector was moved into the composer bar in commit `f46357a`).
3. `packages/svelte/src/components/FileViewerPanel.svelte` (lines 1–267)
   - Why: receives `readWorkspaceFile` as a function prop and calls it
     with `filePath` (no workspace path override is taken).
4. `packages/svelte/src/components/FileViewerModal.svelte` (lines 1–96)
   - Why: thin wrapper that forwards props to `FileViewerPanel`.
5. `packages/svelte/src/layout/AppRightSidebar.svelte` (lines 1–140)
   - Why: passes `diffEntries` and `onOpenFileDiff` from `App.svelte` down
     to `GitPanel`. No repo context is forwarded.
6. `packages/bridge/src/types.ts` (lines 1–200ish, plus `RpcDiffEntry` at
   ~165)
   - Why: defines the wire types. `RpcDiffEntry` has `path`, `oldPath`,
     `status`, `isBinary`, `hunks`. **No `repoRoot` field.**
7. `packages/svelte/src/composables/bridgeStore.svelte.ts` (lines 1–3327,
   focused on `readWorkspaceFile` at 1892 and `fetchDiffEntries` near 2278)
   - Why: `readWorkspaceFile(path)` resolves the workspace via
     `getDisplayedWorkspacePath()` — there is **no second argument**. So
     the only way to point a file read at a different root is to pass
     `workspacePath` in the command payload (used by the debug-session
     path).
8. `packages/bridge/src/ws-rpc-adapter.ts` (lines 6531–6553 for
   `read_workspace_file`, 6615–6644 for `list_diff_entries`,
   1883+ for `parseGitDiff`)
   - Why: server side. `read_workspace_file` honours an explicit
     `workspacePath` and falls back to `sessionRuntime.currentGitCwd()`.
     `parseGitDiff` does **not** attach the repo root to entries — it only
     writes paths relative to the cwd git was run in.
9. `packages/svelte/src/components/GitBranchDropdown.svelte` (lines 31–32,
   404–415) — picks the active repo and triggers `onPickRepo`/
   `onPickBranch` which set `selectedGitRepoRoot` in `App.svelte`.

---

## Key Code

### `App.svelte` — selectedGitRepoRoot is local state, not passed to viewer

```ts
// packages/svelte/src/App.svelte
let selectedGitRepoRoot = $state<string | null>(null);
let modalDiffEntry = $state<RpcDiffEntry | null>(null);

function openFileDiffViewer(entry: RpcDiffEntry) {
  modalFilePath = entry.path;
  modalFileLineNumber = 1;
  modalDiffEntry = entry;        // <-- entry has no repoRoot
  modalFileOpen = true;
}

// readDisplayedWorkspaceFile uses the active session's workspacePath
// (or the debug session's backingWorkspacePath). It does NOT consult
// selectedGitRepoRoot.
async function readDisplayedWorkspaceFile(path: string): Promise<RpcWorkspaceFile> {
  const workspacePath = ... activeDebugSession?.backingWorkspacePath ...
                         ?? bridge.sessionState?.workspacePath;
  ...
  await bridge.sendCommand({
    type: "read_workspace_file",
    path,
    workspacePath,                  // <-- odoo root, not en-erp root
  });
}
```

Wiring into the modal:

```svelte
// packages/svelte/src/App.svelte (lines ~1620-1640)
{#if modalFileOpen}
  <FileViewerModal
    filePath={modalFilePath}
    lineNumber={modalFileLineNumber}
    readWorkspaceFile={readDisplayedWorkspaceFile}
    writeWorkspaceFile={writeDisplayedWorkspaceFile}
    diffEntry={modalDiffEntry}
    onClose={closeFileViewer}
  />
{/if}
```

### `GitPanel.svelte` — repo context was removed

```svelte
// packages/svelte/src/components/GitPanel.svelte (lines 1-18)
let {
  diffEntries = [] as readonly RpcDiffEntry[],
  diffLoading = false,
  onOpenFileDiff = (_: RpcDiffEntry) => {},
  onRefresh = () => {},
}: {
  diffEntries: readonly RpcDiffEntry[];
  diffLoading: boolean;
  onOpenFileDiff: (entry: RpcDiffEntry) => void;
  onRefresh: () => void;
} = $props();
```

The repo selector was removed in commit `f46357a` ("drop Git-tab repo
selector"). The panel now has **no idea** which repo produced the diff
entries — it just renders the list and hands each entry to
`onOpenFileDiff`.

### `FileViewerPanel.svelte` — uses injected reader as-is

```ts
// packages/svelte/src/components/FileViewerPanel.svelte
async function loadFile() {
  ...
  const nextFile = await readWorkspaceFile(filePath);
  ...
}
```

`filePath` is the relative path stored on the diff entry (e.g.
`addons/foo/views.xml`). The injected reader (which resolves to
`readDisplayedWorkspaceFile`) prefixes the active session's
`workspacePath`, not the diff entry's repo root.

### `RpcDiffEntry` — no repoRoot

```ts
// packages/bridge/src/types.ts
export interface RpcDiffEntry {
  path: string;
  status: RpcDiffFileStatus;
  /** Only populated when status is "renamed". */
  oldPath?: string;
  /** True when git reports the file as binary. */
  isBinary?: boolean;
  hunks: RpcDiffHunk[];
}
```

### `bridgeStore.svelte.ts` — readWorkspaceFile takes no workspace arg

```ts
// packages/svelte/src/composables/bridgeStore.svelte.ts (line ~1892)
export async function readWorkspaceFile(
  path: string,
): Promise<RpcWorkspaceFile> {
  const wp = getDisplayedWorkspacePath();    // always active session
  const resp = await sendCommand({
    type: "read_workspace_file",
    path,
    ...(wp ? { workspacePath: wp } : {}),
  });
  ...
}
```

The store *can* be told to use a different workspace via `sendCommand`
directly with an explicit `workspacePath`, but the public
`readWorkspaceFile` does not accept that.

### Bridge `read_workspace_file` honours workspacePath

```ts
// packages/bridge/src/ws-rpc-adapter.ts (line ~6531)
case "read_workspace_file": {
  const result = readWorkspaceFile(
    normalizeOptionalWorkspaceRoot(command.workspacePath) ||
      this.sessionRuntime.currentGitCwd(),
    command.path,
  );
  ...
}
```

So the bridge already supports a `workspacePath` override on
`read_workspace_file`. The bug is purely on the client side: the override
is never sent when the file came from a diff.

---

## Architecture (how the pieces connect)

1. User picks `en-erp` in `GitBranchDropdown.svelte` → `onPickRepo` /
   `onPickBranch` → `App.svelte`'s `handleSelectGitRepo` /
   `handlePickGitBranch`:
   - Stores `selectedGitRepoRoot = repoRoot` in App-local state.
   - Calls `bridge.fetchDiffEntries(true, repoRoot)`.
2. Bridge store sends `list_diff_entries { workspacePath, repoRoot }`.
3. Bridge adapter (lines 6615–6644):
   - Resolves `cwd = repoRoot || workspacePath || currentGitCwd()`.
   - Runs `parseGitDiff(cwd)`, which returns entries with paths
     **relative to the cwd git was run from** (i.e. the en-erp root).
   - Does **not** stamp the repoRoot onto the entries.
4. Client renders `bridge.diffEntries` in `GitPanel`. Each click:
   - `onOpenFileDiff(entry)` → `App.svelte`'s `openFileDiffViewer(entry)`.
   - `modalDiffEntry = entry` (no repo context).
   - `<FileViewerModal>` mounts with `diffEntry={modalDiffEntry}`.
5. `FileViewerPanel` calls `readWorkspaceFile(filePath)`.
6. `App.svelte`'s `readDisplayedWorkspaceFile` is invoked — it always uses
   the active session's `workspacePath` (the outer `odoo` root) and sends
   `read_workspace_file { path, workspacePath: odooRoot }`.
7. Bridge tries to resolve `addons/foo/views.xml` under `odoo` → "file
   does not exist".

---

## Answers to the diagnostic questions

- **Does `RpcDiffEntry` include the repo root?** No. It only has `path`,
  `oldPath`, `status`, `isBinary`, `hunks`. The repo root is dropped on
  the bridge side (`parseGitDiff` does not stamp it).
- **Does `GitPanel` know which repo the diff entry belongs to?** No. The
  repo selector was moved to the composer bar in commit `f46357a`; the
  panel just receives `diffEntries` and `onOpenFileDiff` as opaque
  callbacks. `selectedGitRepoRoot` lives only in `App.svelte`.
- **When opening a diff file, should the workspace path be the repo
  root?** Yes. The diff was produced by running git at the selected
  repo root, and every entry's `path` is relative to that root.

---

## Recommended Fix — Option A is best

**Option A: stamp `repoRoot` on `RpcDiffEntry` server-side, and have the
client pass it as `workspacePath` when reading a diff file.**

Why over the alternatives:

- **B (re-add `selectedRepoRoot` prop to `GitPanel`)** — the dropdown
  was deliberately moved to the composer bar (commit `f46357a`) to fix a
  UI freeze bug and avoid duplicate selectors. Re-adding the prop risks
  regressing that. It also creates a second source of truth for the
  active repo.
- **C (give `FileViewerPanel` a `workspacePath` override for diff mode)**
  — works but requires plumbing through `FileViewerModal` and a third
  "diff-mode workspace" concept, and the modal already takes a
  `diffEntry` that should know its own origin.

Option A puts the truth at the source (the bridge) and keeps the file
viewer ignorant of the composer bar's repo state. It also future-proofs
the diff entry shape for any other consumer (e.g. a "copy relative
path" action that needs to know the repo).

### Concrete change list (for the implementer / reviewer)

1. **Bridge types** (`packages/bridge/src/types.ts`):
   - Add `repoRoot?: string` to `RpcDiffEntry`.

2. **Bridge adapter** (`packages/bridge/src/ws-rpc-adapter.ts`,
   `list_diff_entries` case + `parseGitDiff`):
   - When `command.repoRoot` is provided, set `entries[i].repoRoot =
     command.repoRoot` before returning. (For backward compat, default
     it to the resolved diff root when the call came from a single-repo
     path.)

3. **Bridge store** (`packages/svelte/src/composables/bridgeStore.svelte.ts`):
   - Extend `normalizeDiffEntry` to preserve `repoRoot` when present.
   - Extend the public `readWorkspaceFile` signature to accept an
     optional `options: { workspacePath?: string }` (or a positional
     second arg) and forward it on the `read_workspace_file` command,
     falling back to `getDisplayedWorkspacePath()` when omitted.

4. **App.svelte**:
   - `readDisplayedWorkspaceFile(path, options?)`: when
     `activeDebugSession` is null and we have `modalDiffEntry?.repoRoot`,
     pass that as the workspace override; otherwise fall back to the
     active session's workspace as today.
   - Pass the new options through `readDisplayedWorkspaceFile` to
     `readWorkspaceFile` (and similarly for the debug-session branch).

5. **Tests** (`packages/bridge/src/__tests__/ws-rpc-adapter.test.ts`):
   - Assert that `list_diff_entries` with a `repoRoot` returns entries
     with that `repoRoot` populated.
   - Existing single-repo `list_diff_entries` test should still pass
     (no `repoRoot` populated in response, or it defaults to the
     resolved cwd).

---

## Start Here

Open **`packages/svelte/src/App.svelte`** around the `openFileDiffViewer`
and `readDisplayedWorkspaceFile` functions (search for both). That pair
is the single choke point where the selected repo root needs to start
flowing into the `read_workspace_file` request when the file came from
a diff entry.

---

## Supervisor coordination

Not needed — purely a code investigation; no decision was required and
no plan change was discovered.