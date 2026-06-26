<script lang="ts">
  import type {
    RpcDiffEntry,
    RpcDiffFileStatus,
    RpcDiffLine,
  } from "@pi-web/bridge/types";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import GitBranch from "lucide-svelte/icons/git-branch";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";

  let {
    diffEntries = [] as readonly RpcDiffEntry[],
    diffLoading = false,
    onOpenFile = (_: string) => {},
    onRefresh = () => {},
  }: {
    diffEntries: readonly RpcDiffEntry[];
    diffLoading: boolean;
    onOpenFile: (path: string) => void;
    onRefresh: () => void;
  } = $props();

  let expandedPaths = $state<Set<string>>(new Set());
  let query = $state("");

  function toggle(path: string) {
    if (expandedPaths.has(path)) {
      const next = new Set(expandedPaths);
      next.delete(path);
      expandedPaths = next;
    } else {
      expandedPaths = new Set([...expandedPaths, path]);
    }
  }

  function statusBadge(status: RpcDiffFileStatus): string {
    switch (status) {
      case "added":
        return "A";
      case "deleted":
        return "D";
      case "renamed":
        return "R";
      case "modified":
      default:
        return "M";
    }
  }

  function getFilteredEntries(): readonly RpcDiffEntry[] {
    const trimmed = query.trim();
    if (!trimmed) return diffEntries;
    const q = trimmed.toLowerCase();
    return diffEntries.filter(
      (e) =>
        e.path.toLowerCase().includes(q) ||
        (e.oldPath?.toLowerCase().includes(q) ?? false),
    );
  }
</script>

<div class="git-rail">
  <div class="git-toolbar">
    <div class="git-toolbar-row">
      <input
        bind:value={query}
        class="search-input"
        type="search"
        placeholder="Filter changes..."
        aria-label="Filter changes"
      />
      <button
        type="button"
        class="refresh-btn"
        onclick={() => onRefresh()}
        title="Refresh diff"
        aria-label="Refresh diff"
      >
        <RefreshCw
          size={13}
          class={`refresh-icon${diffLoading ? " spin" : ""}`}
          aria-hidden="true"
        />
      </button>
    </div>
  </div>

  <div class="diff-scroll">
    {#if diffLoading && diffEntries.length === 0}
      <div class="empty-state">
        <p class="empty-title">Loading…</p>
      </div>
    {:else if !diffLoading && diffEntries.length === 0}
      <div class="empty-state">
        <span class="empty-icon" aria-hidden="true">
          <GitBranch size={20} />
        </span>
        <p class="empty-title">No unstaged changes</p>
        <p class="empty-copy">Working tree is clean.</p>
      </div>
    {:else if getFilteredEntries().length === 0}
      <div class="empty-state">
        <p class="empty-title">No matches</p>
        <p class="empty-copy">No files match "{query.trim()}".</p>
      </div>
    {:else}
      <ol class="diff-list">
        {#each getFilteredEntries() as entry (entry.path)}
          {@render diffEntry(entry)}
        {/each}
      </ol>
    {/if}
  </div>
</div>

{#snippet diffEntry(entry: RpcDiffEntry)}
  {@const isOpen = expandedPaths.has(entry.path)}
  <li class="diff-entry">
    <div class="diff-entry-header">
      <button
        class="diff-entry-chevron"
        type="button"
        onclick={() => toggle(entry.path)}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Collapse diff" : "Expand diff"}
      >
        <span class="chevron" aria-hidden="true">
          {#if isOpen}
            <ChevronDown size={12} />
          {:else}
            <ChevronRight size={12} />
          {/if}
        </span>
      </button>
      <span class={`status-badge status-${entry.status}`} aria-hidden="true">
        {statusBadge(entry.status)}
      </span>
      <button
        class="diff-entry-path"
        type="button"
        onclick={() => onOpenFile(entry.path)}
        title={entry.path}
      >
        <span class="label">{entry.path}</span>
      </button>
    </div>
    {#if isOpen}
      <div class="diff-body">
        {#if entry.oldPath && entry.oldPath !== entry.path}
          <div class="diff-rename-note">renamed from {entry.oldPath}</div>
        {/if}
        {#each entry.hunks as hunk, hi (hi)}
          <div class="hunk">
            <div class="hunk-header">
              @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
            </div>
            {#each hunk.lines as line, li (li)}
              {@render diffLine(line)}
            {/each}
          </div>
        {/each}
        {#if entry.hunks.length === 0}
          <div class="diff-empty-hunk">Binary file or no textual content.</div>
        {/if}
      </div>
    {/if}
  </li>
{/snippet}

{#snippet diffLine(line: RpcDiffLine)}
  <div class={`diff-line diff-line-${line.type}`}>
    <span class="line-no line-no-old" aria-hidden="true">
      {line.oldLineNo ?? ""}
    </span>
    <span class="line-no line-no-new" aria-hidden="true">
      {line.newLineNo ?? ""}
    </span>
    <span class="line-marker" aria-hidden="true">
      {line.type === "added" ? "+" : line.type === "deleted" ? "-" : " "}
    </span>
    <span class="line-content">{line.content || "\u00A0"}</span>
  </div>
{/snippet}

<style>
  .git-rail {
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

  .git-toolbar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0 3px 6px;
  }

  .git-toolbar-row {
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

  @keyframes refresh-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .diff-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scrollbar-width: thin;
  }

  .diff-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .diff-entry {
    margin: 0 0 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--panel) 60%, transparent);
    overflow: hidden;
  }

  .diff-entry-header {
    display: flex;
    align-items: stretch;
    min-height: 30px;
  }

  .diff-entry-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-subtle);
    cursor: pointer;
    transition: background 0.12s ease;
  }

  .diff-entry-chevron:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
    color: var(--text-subtle);
    flex-shrink: 0;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border-radius: 4px;
    font-family: var(--pi-font-mono);
    font-size: 0.66rem;
    font-weight: 700;
    line-height: 1;
  }

  .status-modified {
    background: color-mix(in srgb, #1f6feb 24%, transparent);
    color: #79b8ff;
    border: 1px solid color-mix(in srgb, #1f6feb 50%, transparent);
  }

  .status-added {
    background: color-mix(in srgb, #2ea043 24%, transparent);
    color: #56d364;
    border: 1px solid color-mix(in srgb, #2ea043 50%, transparent);
  }

  .status-deleted {
    background: color-mix(in srgb, #da3633 24%, transparent);
    color: #ff7b72;
    border: 1px solid color-mix(in srgb, #da3633 50%, transparent);
  }

  .status-renamed {
    background: color-mix(in srgb, #8957e5 24%, transparent);
    color: #d2a8ff;
    border: 1px solid color-mix(in srgb, #8957e5 50%, transparent);
  }

  .diff-entry-path {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
  }

  .diff-entry-path .label {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }

  .diff-entry-path:hover .label {
    color: var(--accent-hover);
  }

  .diff-body {
    border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    background: var(--bg);
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .diff-rename-note {
    padding: 4px 12px;
    font-size: 0.68rem;
    color: var(--text-subtle);
    font-style: italic;
    background: color-mix(in srgb, var(--panel) 40%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }

  .hunk {
    font-family: var(--pi-font-mono);
    font-size: 0.7rem;
    line-height: 1.4;
  }

  .hunk-header {
    padding: 4px 12px;
    color: var(--text-subtle);
    background: color-mix(in srgb, var(--panel) 50%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
    font-size: 0.66rem;
  }

  .diff-line {
    display: grid;
    grid-template-columns: 40px 40px 18px 1fr;
    align-items: stretch;
    white-space: pre;
  }

  .line-no {
    padding: 0 6px;
    text-align: right;
    color: var(--text-subtle);
    user-select: none;
    font-size: 0.64rem;
    border-right: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .line-marker {
    text-align: center;
    color: var(--text-subtle);
    user-select: none;
  }

  .line-content {
    padding: 0 8px 0 4px;
    overflow-x: auto;
  }

  .diff-line-context {
    background: transparent;
  }

  .diff-line-added {
    background: rgba(46, 160, 67, 0.15);
  }

  .diff-line-added .line-no {
    background: rgba(46, 160, 67, 0.08);
    color: #56d364;
  }

  .diff-line-added .line-marker {
    color: #56d364;
  }

  .diff-line-deleted {
    background: rgba(248, 81, 73, 0.15);
  }

  .diff-line-deleted .line-no {
    background: rgba(248, 81, 73, 0.08);
    color: #ff7b72;
  }

  .diff-line-deleted .line-marker {
    color: #ff7b72;
  }

  .diff-empty-hunk {
    padding: 8px 12px;
    font-size: 0.7rem;
    font-style: italic;
    color: var(--text-subtle);
  }

  .empty-state {
    padding: 20px 14px;
    color: var(--text-subtle);
    text-align: center;
  }

  .empty-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--panel) 60%, transparent);
    color: var(--text-muted);
    margin-bottom: 8px;
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
