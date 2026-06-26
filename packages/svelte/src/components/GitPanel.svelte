<script lang="ts">
  import type {
    RpcDiffEntry,
    RpcDiffFileStatus,
    RpcGitRepoEntry,
  } from "@pi-web/bridge/types";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import GitBranch from "lucide-svelte/icons/git-branch";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";

  let {
    diffEntries = [] as readonly RpcDiffEntry[],
    diffLoading = false,
    gitRepos = [] as readonly RpcGitRepoEntry[],
    gitReposLoading = false,
    selectedRepoRoot = null as string | null,
    onOpenFileDiff = (_: RpcDiffEntry) => {},
    onRefresh = () => {},
    onSelectRepo = (_: string | null) => {},
  }: {
    diffEntries: readonly RpcDiffEntry[];
    diffLoading: boolean;
    gitRepos: readonly RpcGitRepoEntry[];
    gitReposLoading: boolean;
    selectedRepoRoot: string | null;
    onOpenFileDiff: (entry: RpcDiffEntry) => void;
    onRefresh: () => void;
    onSelectRepo: (repoRoot: string | null) => void;
  } = $props();

  let expandedTracked = $state(true);
  let expandedUntracked = $state(false);

  function statusBadge(status: RpcDiffFileStatus): string {
    switch (status) {
      case "added":
        return "A";
      case "untracked":
        return "U";
      case "deleted":
        return "D";
      case "renamed":
        return "R";
      case "modified":
      default:
        return "M";
    }
  }

  let trackedEntries = $derived(
    diffEntries.filter((e) => e.status !== "untracked"),
  );
  let untrackedEntries = $derived(
    diffEntries.filter((e) => e.status === "untracked"),
  );

  // Default selected repo to the first one if not set.
  let effectiveRepoRoot = $derived(
    selectedRepoRoot ?? gitRepos[0]?.root ?? null,
  );
</script>

<div class="git-rail">
  {#if gitRepos.length >= 1}
    <div class="git-repo-selector">
      <label class="git-repo-label" for="git-repo-select">Repo</label>
      <select
        id="git-repo-select"
        class="git-repo-select"
        value={effectiveRepoRoot ?? ""}
        disabled={gitReposLoading}
        onchange={(e) =>
          onSelectRepo((e.currentTarget as HTMLSelectElement).value || null)}
      >
        {#each gitRepos as repo (repo.root)}
          <option value={repo.root}>{repo.label}</option>
        {/each}
      </select>
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
  {:else}
    <div class="git-toolbar">
      <div class="git-toolbar-row">
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
  {/if}

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
    {:else}
      {#if trackedEntries.length > 0}
        <div class="diff-group">
          <button
            type="button"
            class="diff-group-header"
            onclick={() => (expandedTracked = !expandedTracked)}
          >
            {#if expandedTracked}
              <ChevronDown size={12} aria-hidden="true" />
            {:else}
              <ChevronRight size={12} aria-hidden="true" />
            {/if}
            <span class="diff-group-label"
              >Changes ({trackedEntries.length})</span
            >
          </button>
          {#if expandedTracked}
            <ol class="diff-list">
              {#each trackedEntries as entry (entry.path)}
                <li class="diff-entry">
                  <button
                    class="diff-entry-row"
                    type="button"
                    onclick={() => onOpenFileDiff(entry)}
                    title={entry.path}
                  >
                    <span
                      class={`status-badge status-${entry.status}`}
                      aria-hidden="true"
                    >
                      {statusBadge(entry.status)}
                    </span>
                    <span class="diff-entry-path">
                      {#if entry.oldPath && entry.oldPath !== entry.path}
                        <span class="diff-entry-rename"
                          >{entry.oldPath} →
                        </span>
                      {/if}
                      <span class="label">{entry.path}</span>
                    </span>
                  </button>
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      {/if}
      {#if untrackedEntries.length > 0}
        <div class="diff-group">
          <button
            type="button"
            class="diff-group-header"
            onclick={() => (expandedUntracked = !expandedUntracked)}
          >
            {#if expandedUntracked}
              <ChevronDown size={12} aria-hidden="true" />
            {:else}
              <ChevronRight size={12} aria-hidden="true" />
            {/if}
            <span class="diff-group-label"
              >Untracked ({untrackedEntries.length})</span
            >
          </button>
          {#if expandedUntracked}
            <ol class="diff-list">
              {#each untrackedEntries as entry (entry.path)}
                <li class="diff-entry">
                  <button
                    class="diff-entry-row"
                    type="button"
                    onclick={() => onOpenFileDiff(entry)}
                    title={entry.path}
                  >
                    <span
                      class="status-badge status-untracked"
                      aria-hidden="true"
                    >
                      U
                    </span>
                    <span class="diff-entry-path">
                      <span class="label">{entry.path}</span>
                    </span>
                  </button>
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>

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

  .git-repo-selector {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 3px 8px;
  }

  .git-repo-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .git-repo-select {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--panel-2) 60%, transparent);
    color: var(--text);
    font: inherit;
    font-size: 0.74rem;
    cursor: pointer;
  }

  .git-repo-select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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

  .diff-group {
    margin-bottom: 4px;
  }

  .diff-group-header {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 4px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }

  .diff-group-header:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .diff-group-label {
    flex: 1;
    text-align: left;
  }

  .diff-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .diff-entry {
    margin: 0 0 2px;
  }

  .diff-entry-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 30px;
    padding: 4px 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }

  .diff-entry-row:hover {
    background: var(--surface-hover);
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
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

  .status-untracked {
    background: color-mix(in srgb, #d29922 24%, transparent);
    color: #e3b341;
    border: 1px solid color-mix(in srgb, #d29922 50%, transparent);
  }

  .diff-entry-path {
    flex: 1;
    min-width: 0;
    font-family: var(--pi-font-mono);
    font-size: 0.7rem;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }

  .diff-entry-rename {
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