# Code Context

## Files Retrieved
1. `packages/svelte/src/layout/AppRightSidebar.svelte` (lines 1–272) — entire right sidebar component
2. `packages/svelte/src/App.svelte` (lines 1–1602) — entire app root, focusing on:
   - `hasRightSidebarContent` / `hasFilesTab` derivations (lines 522–525)
   - `<AppRightSidebar>` invocation (lines 1459–1474)
   - `outlineSidebarOpen` / `toggleOutlineSidebar` (lines 880–897)
   - `compactLayout` mobile media query CSS (lines 1580–1596)
3. `packages/svelte/src/layout/AppHeader.svelte` (lines 1–301) — entire header (z-index, height, mobile padding)
4. `packages/svelte/src/layout/AppSidebar.svelte` (lines 1–200) — left rail mobile CSS (the comparison point that works correctly)
5. Built artifacts in `web-dist/assets/index-RBEEgskP.js` and `web-dist/assets/index-DVSSLOZq.css` — verified that the production build matches source.

## Key Code

### `AppRightSidebar.svelte` — current (broken) mobile CSS
```css
@media (max-width: 900px) {
    .right-rail {
      position: absolute;
      top: 0;                                /* ← BUG: should be var(--mobile-header-offset, 0px) */
      right: 0;
      bottom: 0;
      width: min(100vw, 520px);
      max-width: 100vw;
      transform: translateX(100%);
      transition: transform 0.2s ease;
      z-index: 15;
    }

    .right-rail.open {
      transform: translateX(0);
      box-shadow: var(--shadow);
    }

    .rail-backdrop {
      display: block;
      position: absolute;
      inset: 0;                              /* ← BUG: should include offset on top */
      background: var(--backdrop);
      z-index: 14;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .right-rail.open ~ .rail-backdrop {
      pointer-events: auto;
      opacity: 1;
    }
}
```

### `AppSidebar.svelte` — analogous left-rail mobile CSS (correct)
```css
@media (max-width: 900px) {
    .left-rail {
      position: absolute;
      top: var(--mobile-header-offset, 0px);  /* ← offset used */
      left: 0;
      bottom: 0;
      width: min(88vw, 360px);
      transform: translateX(-100%);
      transition: transform 0.2s ease;
      z-index: 15;
    }
    ...
    .rail-backdrop {
      display: block;
      position: absolute;
      inset: var(--mobile-header-offset, 0px) 0 0 0;  /* ← offset used */
      background: var(--backdrop);
      ...
    }
}
```

### `App.svelte` — where `--mobile-header-offset` is defined
```css
@media (max-width: 900px) {
    .app-shell {
      --mobile-header-offset: calc(env(safe-area-inset-top) + 50px);
      display: flex;
      flex-direction: column;
    }
    ...
}
```

### `AppHeader.svelte` — relevant mobile CSS
```css
.app-header {
    ...
    height: 44px;
    ...
    z-index: 20;          /* ← higher than .right-rail's z-index: 15 */
}

@media (max-width: 900px) {
    .app-header {
      height: auto;       /* grows with content, but still has z-index: 20 */
      padding: calc(env(safe-area-inset-top) + 7px) 11px 9px;
      border-top-left-radius: 0;
    }
}
```

### `AppRightSidebar.svelte` — `tabs` derivation (CORRECT)
```ts
let tabs = $derived([
    ...(hasTreeTab ? [{ id: "tree", path: "Tree", lineNumber: 0 }] : []),
    ...(hasFilesTab ? [{ id: "files", path: "Files", lineNumber: 0 }] : []),
]);
```
With `hasTreeTab={true}` (hardcoded in `App.svelte:1464`) and `hasFilesTab = hasRightSidebarContent = $derived(true)` (`App.svelte:523–524`), `tabs` correctly evaluates to `[{tree}, {files}]`. Both `.rail-tab-item` buttons render in the DOM. Verified in the build output (`web-dist/assets/index-RBEEgskP.js`).

### `App.svelte` — sidebar invocation (CORRECT)
```svelte
{#if hasRightSidebarContent && outlineSidebarOpen}
1    <AppRightSidebar
       treeEntries={displayedTreeEntries}
       sidebarOpen={outlineSidebarOpen}
       sessionPath={displayedActiveSessionPath}
       hasTreeTab={true}
       {hasFilesTab}
       activeTabId={activeRightSidebarTabId}
       workspaceEntries={displayedWorkspaceEntries}
       workspaceEntriesLoading={displayedWorkspaceEntriesLoading}
       onCloseSidebar={() => (outlineSidebarOpen = false)}
       onSelectTab={handleRightSidebarTabSelect}
       onSelectTreeEntry={handleTreeEntrySelect}
       onOpenFile={(path: string) => openFileViewer(path, 1)}
       onRefresh={handleRefreshWorkspaceEntries}
     />
{/if}
```

## Architecture

- `App.svelte` renders an `<aside class="right-rail">` and a sibling `<div class="rail-backdrop">` (both inside `AppRightSidebar.svelte`).
- On mobile (≤900 px) `app-shell` switches from `display: grid` to `display: flex; flex-direction: column;` and defines the CSS variable `--mobile-header-offset = calc(env(safe-area-inset-top) + 50px)`.
- The right rail becomes `position: absolute; top: 0; right: 0; bottom: 0; width: min(100vw, 520px); z-index: 15;` and slides in via `transform: translateX(0)` when `.open` is set.
- The header sits at the top of the app-shell column with `z-index: 20`.

## Root Cause

**Pure CSS bug in `packages/svelte/src/layout/AppRightSidebar.svelte`.**

On mobile the right rail is positioned at `top: 0` of `.app-shell`, but the `.app-header` occupies the same top region with `z-index: 20` (higher than the rail's `z-index: 15`). The header sits on top of the top ~44–60 px of the right rail — exactly where the `.rail-tabs` flex row (with `min-height: 44px`) is rendered. The header visually hides the entire tab bar, leaving only the `.rail-panel` (which is `flex: 1` and fills the remaining height) visible. That is why the user sees "only the Files tab" with no tab header on mobile.

The left sidebar (`AppSidebar.svelte`) was correctly updated to use `top: var(--mobile-header-offset, 0px)` and `inset: var(--mobile-header-offset, 0px) 0 0 0`, but `AppRightSidebar.svelte` was never given the matching update when the right rail was first introduced in commit `4b4d3fb`. The variable is defined on `.app-shell` (`App.svelte:1582`), so the rail inherits it automatically — no JS or template change required.

The `tabs` array, `hasTreeTab`/`hasFilesTab` props, Svelte 5 reactivity, and the `{#each}` block are all correct. There is no logic bug — only the CSS positioning.

## Required Fix

Edit `packages/svelte/src/layout/AppRightSidebar.svelte` and update the `@media (max-width: 900px)` block:

```css
@media (max-width: 900px) {
    .right-rail {
      position: absolute;
      top: var(--mobile-header-offset, 0px);   /* was: 0 */
      right: 0;
      bottom: 0;
      width: min(100vw, 520px);
      max-width: 100vw;
      transform: translateX(100%);
      transition: transform 0.2s ease;
      z-index: 15;
    }

    .right-rail.open {
      transform: translateX(0);
      box-shadow: var(--shadow);
    }

    .rail-backdrop {
      display: block;
      position: absolute;
      inset: var(--mobile-header-offset, 0px) 0 0 0;   /* was: inset: 0 */
      background: var(--backdrop);
      z-index: 14;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .right-rail.open ~ .rail-backdrop {
      pointer-events: auto;
      opacity: 1;
    }
}
```

After fixing, run `pnpm run build:web` to refresh the published web client (`web-dist/assets/index-*.js` + `index-*.css`), per the project `AGENTS.md` rule for edits to `packages/svelte/src`.

## Start Here

Open `packages/svelte/src/layout/AppRightSidebar.svelte`, find the `@media (max-width: 900px)` block (around lines 213–246), and change the two CSS lines highlighted above. Then rebuild the web client.

## Supervisor coordination
No supervisor contact needed — root cause and fix are unambiguous from static reading.
