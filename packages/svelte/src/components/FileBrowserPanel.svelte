<script lang="ts">
  import type { RpcDirectoryEntry } from "@pi-web/bridge/types";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import File from "lucide-svelte/icons/file";
  import Folder from "lucide-svelte/icons/folder";
  import Loader from "lucide-svelte/icons/loader";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";

  let {
    onFetchDirectory = (_: string) =>
      Promise.resolve([] as RpcDirectoryEntry[]),
    onOpenFile = (_: string) => {},
    onRefresh,
  }: {
    onFetchDirectory?: (path: string) => Promise<RpcDirectoryEntry[]>;
    onOpenFile?: (path: string) => void;
    onRefresh?: () => void;
  } = $props();

  // Cache of loaded directory contents: path -> entries
  let directoryCache = $state<Map<string, RpcDirectoryEntry[]>>(new Map());
  // Paths currently being loaded
  let loadingDirs = $state<Set<string>>(new Set());
  // Paths currently expanded
  let expanded = $state<Set<string>>(new Set());
  // Search query
  let query = $state("");
  // Whether the root directory is being loaded
  let rootLoading = $state(true);
  // Track if root has been loaded at least once
  let rootLoaded = $state(false);

  function displayName(entryPath: string): string {
    const parts = entryPath.split("/");
    return parts[parts.length - 1] || entryPath;
  }

  // Load root directory on mount
  $effect(() => {
    if (!rootLoaded && !loadingDirs.has("")) {
      loadDirectory("");
    }
  });

  async function loadDirectory(dirPath: string) {
    if (directoryCache.has(dirPath)) return;
    loadingDirs = new Set([...loadingDirs, dirPath]);
    try {
      const entries = await onFetchDirectory(dirPath);
      directoryCache = new Map(directoryCache).set(dirPath, entries);
    } catch {
      // On error, don't cache — allow retry on next expand
    } finally {
      const next = new Set(loadingDirs);
      next.delete(dirPath);
      loadingDirs = next;
      if (dirPath === "") rootLoading = false;
      rootLoaded = true;
    }
  }

  function toggle(dirPath: string) {
    if (expanded.has(dirPath)) {
      const next = new Set(expanded);
      next.delete(dirPath);
      expanded = next;
    } else {
      expanded = new Set([...expanded, dirPath]);
      if (!directoryCache.has(dirPath)) {
        loadDirectory(dirPath);
      }
    }
  }

  function handleNodeClick(entry: RpcDirectoryEntry) {
    if (entry.kind === "directory") {
      toggle(entry.path);
    } else {
      onOpenFile(entry.path);
    }
  }

  function refresh() {
    directoryCache = new Map();
    expanded = new Set();
    rootLoading = true;
    rootLoaded = false;
    onRefresh?.();
    loadDirectory("");
  }

  function getFilteredEntries(dirPath: string): RpcDirectoryEntry[] {
    const entries = directoryCache.get(dirPath);
    if (!entries) return [];
    const trimmed = query.trim();
    if (!trimmed) return entries;
    const q = trimmed.toLowerCase();
    return entries.filter(
      e =>
        displayName(e.path).toLowerCase().includes(q) ||
        e.path.toLowerCase().includes(q),
    );
  }
</script>

<div class="file-rail">
  <div class="file-toolbar">
    <div class="file-toolbar-row">
      <input
        bind:value={query}
        class="search-input"
        type="search"
        placeholder="Search files..."
        aria-label="Filter files"
      />
      {#if onRefresh}
        <button
          type="button"
          class="refresh-btn"
          onclick={refresh}
          title="Refresh file list"
          aria-label="Refresh file list"
        >
          <RefreshCw
            size={13}
            class={`refresh-icon${rootLoading ? " spin" : ""}`}
            aria-hidden="true"
          />
        </button>
      {/if}
    </div>
  </div>

  <div class="tree-scroll">
    {#if rootLoading && directoryCache.size === 0}
      <div class="empty-state">
        <p class="empty-title">Loading…</p>
      </div>
    {:else if directoryCache.has("") && getFilteredEntries("").length === 0 && !query.trim()}
      <div class="empty-state">
        <p class="empty-title">No files</p>
        <p class="empty-copy">This workspace has no readable files yet.</p>
      </div>
    {:else if directoryCache.has("") && getFilteredEntries("").length === 0 && query.trim()}
      <div class="empty-state">
        <p class="empty-title">No matches</p>
        <p class="empty-copy">No files match "{query.trim()}".</p>
      </div>
    {:else if directoryCache.has("")}
      <ol class="tree-list" role="tree">
        {#each getFilteredEntries("") as entry (entry.path)}
          {@render treeNode(entry, 0)}
        {/each}
      </ol>
    {/if}
  </div>
</div>

{#snippet treeNode(entry: RpcDirectoryEntry, depth: number)}
  <li
    class="tree-row"
    class:is-dir={entry.kind === "directory"}
    class:is-file={entry.kind === "file"}
    role="treeitem"
    aria-expanded={entry.kind === "directory"
      ? expanded.has(entry.path)
      : undefined}
  >
    <button
      class="tree-item"
      type="button"
      style={`padding-left: ${6 + depth * 14}px`}
      onclick={() => handleNodeClick(entry)}
      title={entry.path}
    >
      {#if entry.kind === "directory"}
        {#if loadingDirs.has(entry.path)}
          <span class="chevron" aria-hidden="true">
            <Loader size={11} class="spin-icon" />
          </span>
        {:else if expanded.has(entry.path)}
          <span class="chevron" aria-hidden="true">
            <ChevronDown size={12} />
          </span>
        {:else}
          <span class="chevron" aria-hidden="true">
            <ChevronRight size={12} />
          </span>
        {/if}
        <span class="icon icon-dir" aria-hidden="true">
          <Folder size={13} />
        </span>
        <span class="label">{displayName(entry.path)}</span>
      {:else}
        <span class="chevron-spacer" aria-hidden="true"></span>
        <span class="icon icon-file" aria-hidden="true">
          <File size={13} />
        </span>
        <span class="label">{displayName(entry.path)}</span>
      {/if}
    </button>
    {#if entry.kind === "directory" && expanded.has(entry.path)}
      {@render directoryChildren(entry.path, depth + 1)}
    {/if}
  </li>
{/snippet}

{#snippet directoryChildren(dirPath: string, depth: number)}
  {#if loadingDirs.has(dirPath)}
    <div class="tree-loading" style={`padding-left: ${6 + depth * 14}px`}>
      <Loader size={11} class="spin-icon" />
      <span>Loading…</span>
    </div>
  {:else if directoryCache.has(dirPath)}
    {#if getFilteredEntries(dirPath).length === 0}
      <div class="tree-empty-dir" style={`padding-left: ${6 + depth * 14}px`}>
        (empty)
      </div>
    {:else}
      <ol class="tree-children" role="group">
        {#each getFilteredEntries(dirPath) as child (child.path)}
          {@render treeNode(child, depth)}
        {/each}
      </ol>
    {/if}
  {/if}
{/snippet}

<style>
  .file-rail {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    padding: 10px 8px 8px;
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--rail-bg) 96%, white 4%),
        color-mix(in srgb, var(--rail-bg) 90%, var(--panel) 10%)
      ),
      var(--rail-bg);
  }

  .file-toolbar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0 3px 6px;
  }

  .file-toolbar-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .search-input {
    height: 26px;
    width: 100%;
    flex: 1;
    min-width: 0;
    border-radius: 7px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel) 88%, transparent);
    color: var(--text);
    padding: 0 8px;
    font-size: 0.73rem;
    outline: none;
  }

  .search-input:focus {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  }

  .refresh-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: color-mix(in srgb, var(--panel) 88%, transparent);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 0.12s ease,
      color 0.12s ease,
      border-color 0.12s ease;
  }

  .refresh-btn:hover {
    background: var(--surface-hover);
    color: var(--text);
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  }

  .refresh-icon {
    transition: color 0.12s ease;
  }

  .refresh-icon.spin {
    animation: refresh-spin 1s linear infinite;
  }

  .spin-icon {
    animation: refresh-spin 1s linear infinite;
  }

  @keyframes refresh-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .tree-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scrollbar-width: thin;
  }

  .tree-list,
  .tree-children {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .tree-row {
    margin: 0;
    padding: 0;
  }

  .tree-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 5px;
    height: 32px;
    padding: 0 8px 0 6px;
    border: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.8rem;
    line-height: 1;
    text-align: left;
    cursor: pointer;
    border-radius: 5px;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .tree-item:hover {
    background: var(--surface-hover);
  }

  .tree-item:focus-visible {
    outline: none;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .chevron,
  .chevron-spacer {
    width: 12px;
    height: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-subtle);
    flex-shrink: 0;
  }

  .chevron-spacer {
    visibility: hidden;
  }

  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }

  .icon-dir {
    color: color-mix(in srgb, var(--accent) 70%, var(--text-muted));
  }

  .icon-file {
    color: var(--text-subtle);
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree-loading,
  .tree-empty-dir {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    font-size: 0.72rem;
    color: var(--text-subtle);
  }

  .tree-empty-dir {
    font-style: italic;
    color: var(--text-subtle);
  }

  .empty-state {
    padding: 16px 12px;
    color: var(--text-subtle);
    text-align: center;
  }

  .empty-title {
    margin: 0 0 4px;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .empty-copy {
    margin: 0;
    font-size: 0.7rem;
    color: var(--text-subtle);
  }
</style>