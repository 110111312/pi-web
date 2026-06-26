<script lang="ts">
  import type {
    RpcDirectoryEntry,
    RpcDiffEntry,
    RpcGitRepoInfo,
  } from "@pi-web/bridge/types";
  import FileBrowserPanel from "../components/FileBrowserPanel.svelte";
  import GitPanel from "../components/GitPanel.svelte";
  import SessionTreeRail from "../components/SessionTreeRail.svelte";
  import type { TreeEntry } from "../composables/bridgeStore.svelte";

  let {
    treeEntries = [] as readonly TreeEntry[],
    sidebarOpen = false,
    sessionPath = null as string | null,
    hasTreeTab = false,
    hasFilesTab = false,
    hasGitTab = false,
    activeTabId = "",
    onFetchDirectory = (_: string) =>
      Promise.resolve([] as RpcDirectoryEntry[]),
    diffEntries = [] as readonly RpcDiffEntry[],
    diffLoading = false,
    gitRepos = [] as readonly RpcGitRepoInfo[],
    gitReposLoading = false,
    selectedRepoRoot = null as string | null,
    onCloseSidebar = () => {},
    onSelectTab = (_: string) => {},
    onSelectTreeEntry = (_: string) => {},
    onOpenFile = (_: string) => {},
    onOpenFileDiff = (_: RpcDiffEntry) => {},
    onRefresh,
    onRefreshDiff = () => {},
  }: {
    treeEntries?: readonly TreeEntry[];
    sidebarOpen?: boolean;
    sessionPath?: string | null;
    hasTreeTab?: boolean;
    hasFilesTab?: boolean;
    hasGitTab?: boolean;
    activeTabId?: string;
    onFetchDirectory?: (path: string) => Promise<RpcDirectoryEntry[]>;
    diffEntries?: readonly RpcDiffEntry[];
    diffLoading?: boolean;
    onCloseSidebar?: () => void;
    onSelectTab?: (tabId: string) => void;
    onSelectTreeEntry?: (entryId: string) => void;
    onOpenFile?: (path: string) => void;
    onOpenFileDiff?: (entry: RpcDiffEntry) => void;
    onSelectRepo?: (repoRoot: string | null) => void;
    onRefresh?: () => void;
    onRefreshDiff?: () => void;
  } = $props();

  let tabs = $derived([
    ...(hasTreeTab ? [{ id: "tree" }] : []),
    ...(hasFilesTab ? [{ id: "files" }] : []),
    ...(hasGitTab ? [{ id: "git" }] : []),
  ]);

  function specialTabLabel(tabId: string): string {
    if (tabId === "tree") return "Tree";
    if (tabId === "git") return "Git";
    return "Files";
  }

  function specialTabTitle(tabId: string): string {
    if (tabId === "tree") return "Session tree";
    if (tabId === "git") return "Git diff";
    return "Files";
  }
</script>

<aside class="right-rail" class:open={sidebarOpen}>
  <div class="rail-shell">
    <div class="rail-tabs" role="tablist" aria-label="Right sidebar panels">
      {#each tabs as tab (tab.id)}
        <div
          class="rail-tab-item"
          class:active={activeTabId === tab.id}
        >
          <button
            id={`right-rail-tab-${tab.id}`}
            class="rail-tab"
            type="button"
            role="tab"
            aria-selected={activeTabId === tab.id}
            aria-controls={`right-rail-panel-${tab.id}`}
            title={specialTabTitle(tab.id)}
            onclick={() => onSelectTab(tab.id)}
          >
            <span class="rail-tab-label">
              {specialTabLabel(tab.id)}
            </span>
          </button>
        </div>
      {/each}
    </div>

    <div class="rail-panel">
      {#if activeTabId === "tree" && hasTreeTab}
        <div
          id="right-rail-panel-tree"
          class="tab-panel"
          role="tabpanel"
          aria-labelledby="right-rail-tab-tree"
        >
          <SessionTreeRail
            entries={treeEntries}
            {sessionPath}
            onSelect={(e: string) => onSelectTreeEntry(e)}
          />
        </div>
      {:else if activeTabId === "files" && hasFilesTab}
        <div
          id="right-rail-panel-files"
          class="tab-panel"
          role="tabpanel"
          aria-labelledby="right-rail-tab-files"
        >
          <FileBrowserPanel
            {onFetchDirectory}
            {onOpenFile}
            {onRefresh}
          />
        </div>
      {:else if activeTabId === "git" && hasGitTab}
        <div
          id="right-rail-panel-git"
          class="tab-panel"
          role="tabpanel"
          aria-labelledby="right-rail-tab-git"
        >
          <GitPanel
            {diffEntries}
            {diffLoading}
            {gitRepos}
            {gitReposLoading}
            {selectedRepoRoot}
            {onOpenFileDiff}
            {onSelectRepo}
            onRefresh={onRefreshDiff}
          />
        </div>
      {/if}
    </div>
  </div>
</aside>
<div class="rail-backdrop" role="button" tabindex="0" onclick={() => onCloseSidebar()} onkeydown={(e) => (e.key === "Enter" || e.key === " ") && onCloseSidebar()}></div>

<style>
  .right-rail {
    min-width: 0;
    height: 100%;
    background: var(--rail-bg);
    border-left: 1px solid var(--border);
    overflow: hidden;
  }

  .rail-shell {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    background: var(--rail-bg);
  }

  .rail-tabs {
    display: flex;
    align-items: center;
    gap: 3px;
    min-height: 44px;
    padding: 6px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .rail-tabs::-webkit-scrollbar {
    display: none;
  }

  .rail-tab-item {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    flex-shrink: 0;
    padding: 0 8px;
    border: none;
    border-radius: 10px;
    background: transparent;
    transition: background 0.14s ease;
  }

  .rail-tab-item:hover {
    background: color-mix(in srgb, var(--panel-2) 44%, transparent);
  }

  .rail-tab-item:focus-within {
    background: color-mix(in srgb, var(--surface-active) 28%, var(--panel-2));
  }

  .rail-tab-item.active {
    background: color-mix(in srgb, var(--panel-2) 92%, var(--rail-bg));
  }

  .rail-tab {
    min-width: 0;
    height: 30px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-subtle);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: color 0.12s ease;
  }

  .rail-tab:hover,
  .rail-tab-item.active .rail-tab {
    color: var(--text);
  }

  .rail-tab-label {
    font-size: 0.73rem;
    font-weight: 600;
    line-height: 1;
  }

  .rail-panel {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .tab-panel {
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .rail-backdrop {
    display: none;
  }

  @media (max-width: 900px) {
    .right-rail {
      position: absolute;
      top: var(--mobile-header-offset, 0px);
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
      inset: var(--mobile-header-offset, 0px) 0 0 0;
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

  @media (max-width: 640px) {
    .right-rail {
      width: 100vw;
      border-left: none;
    }
  }
</style>