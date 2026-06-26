# Code Context

## Files Retrieved
1. `packages/svelte/src/components/GitPanel.svelte` (full file, ~330 lines) — the current working version
2. `packages/svelte/src/App.svelte` (lines 1-70, 520-540, 930-960, 1290-1330, 1543-1570) — imports, state, wiring
3. `packages/svelte/src/layout/AppRightSidebar.svelte` (full file, ~300 lines) — tab panel host

## Current State of GitPanel

**Repo selector** (lines 26, 51-72):
- Visible only when `gitRepos.length >= 1` (`showRepoSelector` derived).
- Native `<select id="git-repo-select">` bound to `selectedRepoRoot ?? ""`.
- `onchange` calls `onSelectRepo(value || null)`.
- Disabled while `gitReposLoading`.

**Search filter** (line 23, 78-86):
- Local `let query = $state("")` in GitPanel (NOT a prop).
- `getFilteredEntries()` filters `diffEntries` by lowercased substring match against `entry.path` and `entry.oldPath`.
- Three empty branches: loading (no entries yet), no entries at all, no matches for query.

**Diff entry list** (lines 109-130):
- `<ol class="diff-list">` with `<button class="diff-entry-row">` per entry, keyed `entry.path`.
- Each row: status badge (A/U/D/R/M from `statusBadge()`) + path (with optional `oldPath →` rename prefix).
- `onclick` calls `onOpenFileDiff(entry)`.

**Props** (lines 7-27):
- `diffEntries: readonly RpcDiffEntry[]`
- `diffLoading: boolean`
- `gitRepos: readonly RpcGitRepoEntry[]`
- `gitReposLoading: boolean`
- `selectedRepoRoot: string | null`
- `onOpenFileDiff: (entry: RpcDiffEntry) => void`
- `onRefresh: () => void` — wired to `onRefreshDiff` by AppRightSidebar
- `onSelectRepo: (repoRoot: string | null) => void`

Internal-only: `query` ($state), `showRepoSelector` ($derived), `getFilteredEntries()`.

## Architecture / Data Flow

```
App.svelte
  ├─ state: selectedGitRepoRoot (App-local $state, null)
  ├─ bridge store: diffEntries, diffLoading, gitRepos, gitReposLoading, gitReposLoaded, diffRepoRoot
  ├─ handlers:
  │    handleRightSidebarTabSelect(tabId)
  │      └─ if GIT_TAB_ID: fetchDiffEntries(false, selectedGitRepoRoot) + fetchGitRepos()
  │    handleRefreshDiffEntries() → bridge.refreshDiffEntries(selectedGitRepoRoot)
  │    handleSelectGitRepo(repoRoot) → sets selectedGitRepoRoot + fetchDiffEntries(true, repoRoot)
  │
  ├─ $effect @ ~1293: when Git tab active AND outlineSidebarOpen AND diffEntries empty AND
  │   diffRepoRoot matches selectedGitRepoRoot → fetchDiffEntries(false, selectedGitRepoRoot)
  │
  ├─ $effect @ ~1315: resets selectedGitRepoRoot = null whenever displayedActiveSessionPath changes
  │
  └─ renders <AppRightSidebar ...> (only when hasRightSidebarContent && outlineSidebarOpen)
        treeEntries={displayedTreeEntries}
        sidebarOpen={outlineSidebarOpen}
        sessionPath={displayedActiveSessionPath}
        hasTreeTab={true}
        hasFilesTab={hasRightSidebarContent}  // always true
        hasGitTab={hasRightSidebarContent}     // always true
        activeTabId={activeRightSidebarTabId}
        onFetchDirectory={fetchDirectoryEntries}
        diffEntries={bridge.diffEntries}
        diffLoading={bridge.diffLoading}
        gitRepos={bridge.gitRepos}
        gitReposLoading={bridge.gitReposLoading}
        selectedRepoRoot={selectedGitRepoRoot}
        onCloseSidebar, onSelectTab, onSelectTreeEntry, onOpenFile, onOpenFileDiff,
        onRefresh={handleRefreshWorkspaceEntries}
        onRefreshDiff={handleRefreshDiffEntries}
        onSelectRepo={handleSelectGitRepo}
```

`AppRightSidebar` derives `tabs = [...(hasTreeTab ? [tree] : []), ...(hasFilesTab ? [files] : []), ...(hasGitTab ? [git] : [])]` and renders the panel matching `activeTabId` (tree/files/git). `GitPanel` is mounted only inside the `activeTabId === "git" && hasGitTab` branch.

**Important wrinkle for any rewrite:** the local `query` state currently lives inside `GitPanel` and is NOT lifted to App. If a prior rewrite lifted it, the lost-on-tab-switch behavior (and any prop-shape mismatch) is a likely breakage source.

## Start Here

Open `packages/svelte/src/App.svelte` around lines **1290-1330** first. The two `$effect`s there:
1. The auto-fetch effect has three conjoined conditions plus `outlineSidebarOpen`. If a rewrite dropped or renamed `outlineSidebarOpen` (or wired `diffRepoRoot` differently), the panel can stay empty with no fetch ever firing — matching "sessions not showing, UI stuck".
2. The session-switch effect blindly resets `selectedGitRepoRoot = null`. If a prior rewrite replaced this with logic that references stale state or an effect that triggers before session path is set, the selector can desync.

Then cross-check `handleSelectGitRepo` (line ~953) and the `hasGitTab` derived (line 530) — both are load-bearing for tab wiring.

## Verification Results

- `pnpm run check` → passed (tsgo + electron tsc, no errors)
- `pnpm test -- --run` → passed (7 files, 159 tests, 10.3s)
- `git status` → clean working tree; HEAD is `8328c78 Revert "fix: repo selector defaults to main repo, ..."`