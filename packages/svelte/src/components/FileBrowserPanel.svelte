<script lang="ts">
  import type { RpcWorkspaceEntry } from "@pi-web/bridge/types";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import File from "lucide-svelte/icons/file";
  import Folder from "lucide-svelte/icons/folder";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";
  import { buildFileTree, filterFileTree, type FileTreeNode } from "../utils/fileTree";

  let {
    entries = [] as readonly RpcWorkspaceEntry[],
    loading = false,
    onOpenFile = (_: string) => {},
    onRefresh,
  }: {
    entries?: readonly RpcWorkspaceEntry[];
    loading?: boolean;
    onOpenFile?: (path: string) => void;
    onRefresh?: () => void;
  } = $props();

  let query = $state("");
  let expanded = $state<Set<string>>(new Set());

  let baseTree = $derived(buildFileTree(entries));

  // Auto-expand the root level on first entries load so users see top-level
  // directories by default.
  let autoExpandedVersion = 0;
  $effect(() => {
    // Track entry count changes; whenever a fresh set of entries arrives,
    // expand all top-level directories.
    const version = ++autoExpandedVersion;
    void entries.length;
    if (version === 1) {
      const next = new Set<string>();
      for (const node of baseTree) {
        if (node.kind === "directory") {
          next.add(node.path);
        }
      }
      expanded = next;
    }
  });

  let filteredTree = $derived(filterFileTree(baseTree, query));

  // Ensure all directories that contain a match are visible (filtered tree
  // already keeps ancestors). When the query is empty we trust the user's
  // own expanded state; when filtered, force-expand ancestors of matches.
  let visibleTree = $derived.by((): FileTreeNode[] => {
    const trimmed = query.trim();
    if (!trimmed) {
      return pruneCollapsed(baseTree, expanded);
    }
    // For filtered views, always show the matched sub-tree fully expanded.
    return filteredTree;
  });

  function pruneCollapsed(
    nodes: FileTreeNode[],
    expandedSet: Set<string>,
  ): FileTreeNode[] {
    const result: FileTreeNode[] = [];
    for (const node of nodes) {
      if (node.kind === "file") {
        result.push(node);
        continue;
      }
      if (expandedSet.has(node.path)) {
        result.push({
          ...node,
          children: pruneCollapsed(node.children, expandedSet),
        });
      } else {
        result.push({ ...node, children: [] });
      }
    }
    return result;
  }

  function toggle(path: string) {
    const next = new Set(expanded);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    expanded = next;
  }

  function openNode(node: FileTreeNode) {
    if (node.kind === "directory") {
      toggle(node.path);
    } else {
      onOpenFile(node.path);
    }
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
          onclick={() => onRefresh?.()}
          title="Refresh file list"
          aria-label="Refresh file list"
          disabled={loading}
        >
          <RefreshCw
            size={13}
            class={`refresh-icon${loading ? " spin" : ""}`}
            aria-hidden="true"
          />
        </button>
      {/if}
    </div>
  </div>

  <div class="tree-scroll">
    {#if loading}
      <div class="empty-state">
        <p class="empty-title">Loading…</p>
      </div>
    {:else if entries.length === 0}
      <div class="empty-state">
        <p class="empty-title">No files</p>
        <p class="empty-copy">This workspace has no readable files yet.</p>
      </div>
    {:else if visibleTree.length === 0}
      <div class="empty-state">
        <p class="empty-title">No matches</p>
        <p class="empty-copy">No files match “{query.trim()}”.</p>
      </div>
    {:else}
      <ol class="tree-list" role="tree">
        {#each visibleTree as node (node.path)}
          {@render treeRow(node, 0)}
        {/each}
      </ol>
    {/if}
  </div>
</div>

{#snippet treeRow(node: FileTreeNode, depth: number)}
  <li
    class="tree-row"
    class:is-dir={node.kind === "directory"}
    class:is-file={node.kind === "file"}
    role="treeitem"
    aria-expanded={node.kind === "directory" ? expanded.has(node.path) : undefined}
  >
    <button
      class="tree-item"
      type="button"
      style={`padding-left: ${6 + depth * 14}px`}
      onclick={() => openNode(node)}
      title={node.path}
    >
      {#if node.kind === "directory"}
        <span class="chevron" aria-hidden="true">
          {#if expanded.has(node.path)}
            <ChevronDown size={12} />
          {:else}
            <ChevronRight size={12} />
          {/if}
        </span>
        <span class="icon icon-dir" aria-hidden="true">
          <Folder size={13} />
        </span>
        <span class="label">{node.name}</span>
      {:else}
        <span class="chevron-spacer" aria-hidden="true"></span>
        <span class="icon icon-file" aria-hidden="true">
          <File size={13} />
        </span>
        <span class="label">{node.name}</span>
      {/if}
    </button>
    {#if node.kind === "directory" && expanded.has(node.path) && node.children.length > 0}
      <ol class="tree-children" role="group">
        {#each node.children as child (child.path)}
          {@render treeRow(child, depth + 1)}
        {/each}
      </ol>
    {/if}
  </li>
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

  .refresh-btn:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  }

  .refresh-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .refresh-icon {
    transition: color 0.12s ease;
  }

  .refresh-icon.spin {
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
    height: 24px;
    padding: 0 8px 0 6px;
    border: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.78rem;
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