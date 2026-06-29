<script lang="ts">
  import type {
    RpcGitBranch,
    RpcGitRepoEntry,
    RpcGitRepoState,
  } from "@pi-web/bridge/types";
  import Check from "lucide-svelte/icons/check";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import GitBranchIcon from "lucide-svelte/icons/git-branch";
  import Plus from "lucide-svelte/icons/plus";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";

  let {
    label = null as string | null,
    repoState = null as RpcGitRepoState | null,
    loading = false,
    switching = false,
    disabled = false,
    refresh = (_?: boolean) =>
      Promise.resolve(null as RpcGitRepoState | null),
    switchBranch = (_: string) =>
      Promise.resolve(null as RpcGitRepoState | null),
    createBranch = (_: string) =>
      Promise.resolve(null as RpcGitRepoState | null),
    repos = [] as readonly RpcGitRepoEntry[],
    reposLoading = false,
    repoStateByRoot = {} as Readonly<Record<string, RpcGitRepoState>>,
    repoStateLoadingByRoot = {} as Readonly<Record<string, boolean>>,
    selectedRepoRoot = null as string | null,
    onPickRepo = (_: string | null) => {},
    onPickBranch = async (_: string, __: RpcGitBranch) => {},
    onCreateBranch = async (_: string, __: string) => {},
    refreshRepoState = async (_?: string | null, __?: boolean) =>
      null as RpcGitRepoState | null,
  } = $props();

  const isGroupedMode = $derived(repos.length > 1);

  // Effective active repo for chip label when grouped.
  let activeGroupedRepoRoot = $derived(
    selectedRepoRoot ?? (repos[0]?.root ?? null),
  );
  let activeGroupedRepo = $derived(
    activeGroupedRepoRoot
      ? (repos.find(r => r.root === activeGroupedRepoRoot) ?? null)
      : (repos[0] ?? null),
  );
  let activeGroupedRepoState = $derived.by(() => {
    const root = activeGroupedRepo?.root;
    if (!root) return null;
    return repoStateByRoot[root] ?? null;
  });

  // The label shown on the trigger button.
  let displayLabel = $derived.by(() => {
    // Single-repo mode preserves the existing flat behavior.
    if (!isGroupedMode) {
      const fb = repoState?.headLabel ?? label;
      const branch = fb?.trim();
      return branch ? branch : null;
    }
    // Grouped mode: show "<repo>/<branch>" when current branch is known.
    if (activeGroupedRepoState?.headLabel && activeGroupedRepo) {
      const head = activeGroupedRepoState.headLabel.trim();
      if (head) return `${activeGroupedRepo.label}/${head}`;
    }
    // Fallback: just show the repo label (or bare "git branch" if no repo).
    if (activeGroupedRepo) return activeGroupedRepo.label;
    return label ?? null;
  });

  let isBusy = $derived(loading || switching);
  let rootRef = $state<HTMLElement | null>(null);
  let triggerRef = $state<HTMLButtonElement | null>(null);
  let searchInputRef = $state<HTMLInputElement | null>(null);
  let listRef = $state<HTMLElement | null>(null);
  let isOpen = $state(false);
  let searchText = $state("");
  let highlightedIndex = $state(0);

  // ---------- Single-repo mode derivations (unchanged from the prior component) ----------

  function mergeBranchesFor(state: RpcGitRepoState | null): RpcGitBranch[] {
    if (!state) return [];
    const byShortName = new Map<
      string,
      { local?: RpcGitBranch; remotes: RpcGitBranch[] }
    >();
    for (const branch of state.branches) {
      const group = byShortName.get(branch.shortName) ?? { remotes: [] };
      if (branch.kind === "local") {
        group.local = branch;
      } else {
        group.remotes.push(branch);
      }
      byShortName.set(branch.shortName, group);
    }
    const result: RpcGitBranch[] = [];
    const seen = new Set<string>();
    for (const branch of state.branches) {
      const group = byShortName.get(branch.shortName);
      if (!group || seen.has(branch.shortName)) continue;
      seen.add(branch.shortName);
      if (group.local) {
        result.push(group.local);
      } else if (group.remotes.length > 0) {
        result.push(group.remotes[0]);
      }
    }
    return result;
  }

  let mergedBranches = $derived(mergeBranchesFor(repoState));

  let filteredBranches = $derived.by(() => {
    if (!repoState) return [] as RpcGitBranch[];
    const query = searchText.trim().toLowerCase();
    if (!query) return mergedBranches;
    return mergedBranches.filter(branch => {
      const display =
        branch.kind === "remote" && branch.remoteName
          ? `${branch.remoteName}/${branch.shortName}`
          : branch.shortName;
      return [branch.name, display].join(" ").toLowerCase().includes(query);
    });
  });

  let exactBranchMatch = $derived(
    searchText.trim()
      ? mergedBranches.find(b => b.name === searchText.trim()) ?? null
      : null,
  );
  let canCreateBranch = $derived(
    Boolean(searchText.trim()) && !exactBranchMatch,
  );
  let createButtonLabel = $derived(
    searchText.trim() ? `Create ${searchText.trim()}` : "Create branch",
  );

  let triggerTitle = $derived.by(() => {
    if (!displayLabel) return "Git branch";
    if (!isGroupedMode && repoState?.isDirty)
      return `${displayLabel} (working tree has uncommitted changes)`;
    return displayLabel;
  });

  // ---------- Grouped-mode derivations ----------

  type GroupEntry = {
    repo: RpcGitRepoEntry;
    state: RpcGitRepoState | null;
    loading: boolean;
    branches: RpcGitBranch[];
  };

  let groupedEntries = $derived.by(() => {
    if (!isGroupedMode) return [] as GroupEntry[];
    return repos.map(repo => {
      const state = repoStateByRoot[repo.root] ?? null;
      const isLoading = !!repoStateLoadingByRoot[repo.root];
      const branches = mergeBranchesFor(state);
      return { repo, state, loading: isLoading, branches };
    });
  });

  // Flat list across all repos for keyboard navigation and search filter.
  type FlatEntry = {
    repo: RpcGitRepoEntry;
    branch: RpcGitBranch | null; // null = repo header row
    kind: "repo-header" | "branch";
  };

  let flatEntries = $derived.by(() => {
    if (!isGroupedMode) return [] as FlatEntry[];
    const out: FlatEntry[] = [];
    for (const g of groupedEntries) {
      out.push({ repo: g.repo, branch: null, kind: "repo-header" });
      for (const b of g.branches) {
        out.push({ repo: g.repo, branch: b, kind: "branch" });
      }
    }
    return out;
  });

  // Filtered flat entries (skipping repo headers when filtering).
  let groupedHighlightIndex = $state(0);

  // Track which repo sections are expanded in grouped mode. Empty by default
  // so the dropdown shows only repo headers; users expand the one they want.
  let expandedRepoRoots = $state<Set<string>>(new Set());

  function isRepoExpanded(root: string): boolean {
    // While searching, auto-expand all sections so filtered branches are visible.
    if (searchText.trim()) return true;
    return expandedRepoRoots.has(root);
  }

  function toggleRepoExpanded(root: string): void {
    const next = new Set(expandedRepoRoots);
    if (next.has(root)) {
      next.delete(root);
    } else {
      next.add(root);
    }
    expandedRepoRoots = next;
  }
  let visibleBranchEntries = $derived.by(() => {
    if (!isGroupedMode) return [] as FlatEntry[];
    const q = searchText.trim().toLowerCase();
    if (!q) {
      // Only branches, in repo order.
      return flatEntries.filter(e => e.kind === "branch");
    }
    return flatEntries.filter(e => {
      if (e.kind !== "branch" || !e.branch) return false;
      const repoMatch = e.repo.label.toLowerCase().includes(q);
      const branch = e.branch;
      const display =
        branch.kind === "remote" && branch.remoteName
          ? `${branch.remoteName}/${branch.shortName}`
          : branch.shortName;
      const branchMatch =
        [branch.name, display].join(" ").toLowerCase().includes(q);
      return repoMatch || branchMatch;
    });
  });

  let groupedExactBranchMatch = $derived.by(() => {
    if (!isGroupedMode) return null as RpcGitBranch | null;
    const q = searchText.trim();
    if (!q) return null;
    for (const g of groupedEntries) {
      const found = g.branches.find(b => b.name === q);
      if (found) return found;
    }
    return null;
  });

  let groupedCanCreateBranch = $derived(
    Boolean(searchText.trim()) && !groupedExactBranchMatch,
  );

  let groupedCreateButtonLabel = $derived.by(() => {
    const q = searchText.trim();
    if (!q || !activeGroupedRepo) return "Create branch";
    return `Create on ${activeGroupedRepo.label}: ${q}`;
  });

  // ---------- Shared helpers ----------

  function branchDisplayName(branch: RpcGitBranch): string {
    if (branch.kind === "remote" && branch.remoteName) {
      return `${branch.remoteName}/${branch.shortName}`;
    }
    return branch.shortName;
  }

  function syncHighlightedIndex() {
    if (isGroupedMode) {
      if (visibleBranchEntries.length === 0) {
        groupedHighlightIndex = 0;
        return;
      }
      const q = searchText.trim();
      const emi = visibleBranchEntries.findIndex(
        e => e.kind === "branch" && e.branch && e.branch.name === q,
      );
      if (emi >= 0) {
        groupedHighlightIndex = emi;
        return;
      }
      const ci = visibleBranchEntries.findIndex(
        e => e.kind === "branch" && e.branch?.isCurrent,
      );
      groupedHighlightIndex = ci >= 0 ? ci : 0;
      return;
    }
    const list = filteredBranches;
    if (list.length === 0) {
      highlightedIndex = 0;
      return;
    }
    const emi = list.findIndex(b => b.name === searchText.trim());
    if (emi >= 0) { highlightedIndex = emi; return; }
    const ci = list.findIndex(b => b.isCurrent);
    highlightedIndex = ci >= 0 ? ci : 0;
  }

  function scrollToHighlighted() {
    queueMicrotask(() => {
      if (isGroupedMode) {
        const target = listRef?.children[groupedHighlightIndex] as
          | HTMLElement
          | undefined;
        target?.scrollIntoView({ block: "nearest" });
        return;
      }
      const el = listRef?.children[highlightedIndex] as
        | HTMLElement
        | undefined;
      el?.scrollIntoView({ block: "nearest" });
    });
  }

  // Auto-load branches for every known repo the first time the dropdown opens
  // (or when the repo list changes). Avoids blocking on selection.
  $effect(() => {
    // Track length unconditionally so this effect re-fires when the repo
    // list grows from 1 to N (e.g. workspace switch reveals a nested repo).
    void repos.length;
    void repoStateByRoot;
    void repoStateLoadingByRoot;
    if (!isGroupedMode || !isOpen) return;
    for (const repo of repos) {
      if (!repoStateByRoot[repo.root] && !repoStateLoadingByRoot[repo.root]) {
        // Fire-and-forget; errors are surfaced via notifications.
        void refreshRepoState(repo.root, true).catch(() => {});
      }
    }
  });

  async function openDropdown() {
    if (disabled || !displayLabel) return;
    isOpen = true;
    searchText = "";
    syncHighlightedIndex();
    if (!isGroupedMode) {
      if (!repoState && !loading) {
        await refresh(true);
        syncHighlightedIndex();
        scrollToHighlighted();
      } else {
        scrollToHighlighted();
      }
      return;
    }
    // Grouped: triggers $effect to load any missing repo states.
    scrollToHighlighted();
  }

  function closeDropdown(options?: { focusTrigger?: boolean }) {
    isOpen = false;
    searchText = "";
    if (options?.focusTrigger) {
      queueMicrotask(() => triggerRef?.focus());
    }
  }

  function toggleDropdown() {
    if (isOpen) { closeDropdown(); return; }
    void openDropdown();
  }

  function updateHighlight(nextIndex: number) {
    if (isGroupedMode) {
      const maxIndex = visibleBranchEntries.length - 1;
      groupedHighlightIndex = Math.min(Math.max(nextIndex, 0), maxIndex);
      scrollToHighlighted();
      return;
    }
    const maxIndex = filteredBranches.length - 1;
    highlightedIndex = Math.min(Math.max(nextIndex, 0), maxIndex);
    scrollToHighlighted();
  }

  async function handleRefresh(force = true) {
    if (isBusy) return;
    if (isGroupedMode) {
      // Refresh all known repos.
      await Promise.all(
        repos.map(r => refreshRepoState(r.root, force).catch(() => null)),
      );
      syncHighlightedIndex();
      scrollToHighlighted();
      return;
    }
    await refresh(force);
    syncHighlightedIndex();
    scrollToHighlighted();
  }

  async function selectBranch(branch: RpcGitBranch) {
    if (switching) return;
    if (branch.isCurrent) {
      closeDropdown({ focusTrigger: true });
      return;
    }
    const nextState = await switchBranch(branch.name);
    if (nextState) closeDropdown({ focusTrigger: true });
  }

  async function handleCreateBranch() {
    if (!canCreateBranch || switching) return;
    const nextState = await createBranch(searchText.trim());
    if (nextState) closeDropdown({ focusTrigger: true });
  }

  function selectRepo(repo: RpcGitRepoEntry) {
    if (selectedRepoRoot === repo.root) {
      closeDropdown({ focusTrigger: true });
      return;
    }
    onPickRepo(repo.root);
    closeDropdown({ focusTrigger: true });
  }

  async function handleGroupedBranchPick(repo: RpcGitRepoEntry, branch: RpcGitBranch) {
    if (switching) return;
    if (branch.isCurrent) {
      onPickRepo(repo.root);
      closeDropdown({ focusTrigger: true });
      return;
    }
    await onPickBranch(repo.root, branch);
    closeDropdown({ focusTrigger: true });
  }

  async function handleGroupedCreate() {
    if (!groupedCanCreateBranch || switching || !activeGroupedRepo) return;
    await onCreateBranch(activeGroupedRepo.root, searchText.trim());
    closeDropdown({ focusTrigger: true });
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (disabled || !displayLabel) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!isOpen) { void openDropdown(); return; }
        updateHighlight(
          isGroupedMode ? groupedHighlightIndex + 1 : highlightedIndex + 1,
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!isOpen) { void openDropdown(); return; }
        updateHighlight(
          isGroupedMode ? groupedHighlightIndex - 1 : highlightedIndex - 1,
        );
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        toggleDropdown();
        break;
    }
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (!isOpen) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (isGroupedMode) {
          if (visibleBranchEntries.length > 0)
            updateHighlight(
              (groupedHighlightIndex + 1) % visibleBranchEntries.length,
            );
          break;
        }
        if (filteredBranches.length > 0)
          updateHighlight((highlightedIndex + 1) % filteredBranches.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (isGroupedMode) {
          if (visibleBranchEntries.length > 0)
            updateHighlight(
              (groupedHighlightIndex - 1 + visibleBranchEntries.length) %
                visibleBranchEntries.length,
            );
          break;
        }
        if (filteredBranches.length > 0)
          updateHighlight(
            (highlightedIndex - 1 + filteredBranches.length) %
              filteredBranches.length,
          );
        break;
      case "Enter": {
        event.preventDefault();
        if (isGroupedMode) {
          if (groupedCanCreateBranch) { void handleGroupedCreate(); break; }
          const entry = visibleBranchEntries[groupedHighlightIndex];
          if (entry?.kind === "branch" && entry.branch) {
            void handleGroupedBranchPick(entry.repo, entry.branch);
          }
          break;
        }
        if (canCreateBranch) { void handleCreateBranch(); break; }
        const branch = filteredBranches[highlightedIndex];
        if (branch) void selectBranch(branch);
        break;
      }
      case "Escape":
        event.preventDefault();
        closeDropdown({ focusTrigger: true });
        break;
      case "Tab":
        closeDropdown();
        break;
    }
  }

  function handleDocumentMousedown(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!rootRef?.contains(target)) closeDropdown();
  }

  $effect(() => {
    if (typeof document === "undefined") return;
    if (isOpen) {
      document.addEventListener("mousedown", handleDocumentMousedown);
      return () =>
        document.removeEventListener("mousedown", handleDocumentMousedown);
    }
  });

  $effect(() => {
    if (isGroupedMode) {
      void visibleBranchEntries;
      if (groupedHighlightIndex >= visibleBranchEntries.length) {
        groupedHighlightIndex = Math.max(0, visibleBranchEntries.length - 1);
      }
      scrollToHighlighted();
      return;
    }
    void filteredBranches;
    if (highlightedIndex >= filteredBranches.length)
      highlightedIndex = Math.max(0, filteredBranches.length - 1);
    scrollToHighlighted();
  });

  $effect(() => {
    if (!isOpen) return;
    if (isGroupedMode) {
      void groupedEntries;
      syncHighlightedIndex();
      scrollToHighlighted();
      return;
    }
    void repoState;
    syncHighlightedIndex();
    scrollToHighlighted();
  });
</script>

{#if displayLabel}
  <div bind:this={rootRef} class="git-dropdown">
    <button
      bind:this={triggerRef}
      class="git-trigger"
      type="button"
      disabled={disabled || isBusy}
      title={triggerTitle}
      aria-expanded={isOpen}
      aria-haspopup="dialog"
      onclick={toggleDropdown}
      onkeydown={handleTriggerKeydown}
    >
      <GitBranchIcon aria-hidden="true" size={12} />
      <span class="git-trigger-text">{displayLabel}</span>
    </button>

    {#if isOpen}
      <div class="git-menu">
        <div class="git-search-row">
          <label class="git-search">
            <input
              bind:this={searchInputRef}
              bind:value={searchText}
              class="git-search-input"
              type="text"
              placeholder={isGroupedMode
                ? "Find or create branch (search all repos)"
                : "Find or create branch"}
              onkeydown={handleSearchKeydown}
            />
          </label>
          <button
            class="git-refresh"
            type="button"
            disabled={isBusy}
            title="Refresh branches"
            onclick={() => handleRefresh(true)}
          >
            <span
              class="git-refresh-icon"
              class:spin={loading || reposLoading}
            >
              <RefreshCw
                aria-hidden="true"
                size={14}
              />
            </span>
          </button>
        </div>

        {#if isGroupedMode}
          {#if groupedCanCreateBranch && activeGroupedRepo}
            <button
              class="git-create"
              type="button"
              disabled={switching}
              onclick={handleGroupedCreate}
            >
              <Plus class="git-create-icon" aria-hidden="true" size={14} />
              <span class="git-create-label">{groupedCreateButtonLabel}</span>
            </button>
          {:else if groupedExactBranchMatch}
            <div class="git-match-note">
              Branch already exists. Press Enter to switch.
            </div>
          {/if}

          {#if visibleBranchEntries.length === 0 && Object.keys(repoStateByRoot).length === 0}
            <div class="git-empty">Loading repositories…</div>
          {:else if visibleBranchEntries.length === 0}
            <div class="git-empty">No matching branches</div>
          {:else}
            <ul
              bind:this={listRef}
              class="git-list git-list-grouped"
              role="listbox"
              tabindex="-1"
              onkeydown={handleSearchKeydown}
            >
              {#each groupedEntries as group (group.repo.root)}
                {@const expanded = isRepoExpanded(group.repo.root)}
                <li class="git-repo-group">
                  <button
                    type="button"
                    class="git-repo-header"
                    aria-expanded={expanded}
                    onclick={() => toggleRepoExpanded(group.repo.root)}
                  >
                    {#if expanded}
                      <ChevronDown
                        class="git-repo-chevron"
                        aria-hidden="true"
                        size={12}
                      />
                    {:else}
                      <ChevronRight
                        class="git-repo-chevron"
                        aria-hidden="true"
                        size={12}
                      />
                    {/if}
                    <span class="git-repo-label">{group.repo.label}</span>
                    <span class="git-repo-meta">
                      {#if group.loading}
                        loading
                      {:else if group.state?.currentBranch}
                        {group.state.currentBranch}
                      {:else if group.state?.detached}
                        {group.state.headLabel || "detached"}
                      {:else if group.state?.headLabel}
                        {group.state.headLabel}
                      {/if}
                    </span>
                  </button>
                  {#if expanded}
                    {#if group.state === null && group.loading === false && Object.keys(repoStateByRoot).length > 0}
                      <div class="git-repo-empty">No branches</div>
                    {:else if !group.state && group.loading}
                      <div class="git-repo-empty">Loading…</div>
                    {:else if group.branches.length === 0}
                      <div class="git-repo-empty">No branches</div>
                    {:else}
                      <ol class="git-repo-branches">
                        {#each group.branches as branch (`${group.repo.root}:${branch.kind}:${branch.name}`)}
                          {@const flatIdx = visibleBranchEntries.findIndex(e => e.kind === "branch" && e.branch === branch)}
                          <li class="git-list-item">
                            <button
                              class="git-option"
                              type="button"
                              class:highlighted={flatIdx === groupedHighlightIndex}
                              class:selected={branch.isCurrent}
                              disabled={switching}
                              onclick={() => handleGroupedBranchPick(group.repo, branch)}
                              onmouseenter={() => {
                                if (flatIdx >= 0) groupedHighlightIndex = flatIdx;
                              }}
                            >
                              <span class="git-option-name">
                                {branchDisplayName(branch)}
                              </span>
                              {#if branch.isCurrent}
                                <Check
                                  class="git-option-check"
                                  aria-hidden="true"
                                  size={14}
                                />
                              {/if}
                            </button>
                          </li>
                        {/each}
                      </ol>
                    {/if}
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          {#if repoState && canCreateBranch}
            <button
              class="git-create"
              type="button"
              disabled={switching}
              onclick={handleCreateBranch}
            >
              <Plus class="git-create-icon" aria-hidden="true" size={14} />
              <span class="git-create-label">{createButtonLabel}</span>
            </button>
          {:else if repoState && exactBranchMatch}
            <div class="git-match-note">
              Branch already exists. Press Enter to switch.
            </div>
          {/if}

          {#if loading && !repoState}
            <div class="git-empty">Loading branches...</div>
          {:else if !repoState}
            <div class="git-empty">No git repository found.</div>
          {:else if filteredBranches.length === 0}
            <div class="git-empty">No matching branches</div>
          {:else}
            <ul
              bind:this={listRef}
              class="git-list"
              role="listbox"
              tabindex="-1"
              onkeydown={handleSearchKeydown}
            >
              {#each filteredBranches as branch, index (`${branch.kind}:${branch.name}`)}
                <li class="git-list-item">
                  <button
                    class="git-option"
                    type="button"
                    class:highlighted={index === highlightedIndex}
                    class:selected={branch.isCurrent}
                    disabled={switching}
                    onclick={() => selectBranch(branch)}
                    onmouseenter={() => (highlightedIndex = index)}
                  >
                    <span class="git-option-name">{branchDisplayName(branch)}</span>
                    {#if branch.isCurrent}
                      <Check
                        class="git-option-check"
                        aria-hidden="true"
                        size={14}
                      />
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .git-dropdown {
    position: relative;
    min-width: 0;
  }

  .git-trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .git-trigger:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
  }

  .git-trigger[aria-expanded="true"] {
    background: var(--surface-active);
    color: var(--text);
  }

  .git-trigger:focus-visible {
    outline: none;
    color: var(--text);
  }

  .git-trigger:disabled {
    cursor: not-allowed;
    opacity: 0.72;
  }

  .git-trigger-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--pi-font-mono);
    font-size: 0.64rem;
  }

  .git-menu {
    position: absolute;
    left: 0;
    bottom: calc(100% + 10px);
    width: min(360px, calc(100vw - 48px));
    padding: 8px;
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--panel) 97%, transparent),
      var(--bg-elevated)
    );
    box-shadow: var(--shadow-floating);
    backdrop-filter: blur(18px);
    z-index: 18;
  }

  .git-search-row {
    display: flex;
    align-items: stretch;
    gap: 7px;
    margin-bottom: 6px;
  }

  .git-refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    width: 34px;
    padding: 0;
    border-radius: 10px;
    border: none;
    background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
    color: var(--text-subtle);
    cursor: pointer;
    flex-shrink: 0;
  }

  .git-refresh:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
  }

  .git-refresh:focus-visible {
    background: var(--surface-hover);
    color: var(--text);
    outline: none;
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .git-refresh:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .git-search {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 9px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
  }

  .git-search:focus-within {
    background: var(--panel);
  }

  .git-search-input {
    width: 100%;
    border: none;
    background: transparent;
    color: var(--text);
    font-family: var(--pi-font-mono);
    font-size: 0.78rem;
    outline: none;
  }

  .git-search-input::placeholder {
    color: var(--text-subtle);
  }

  .git-refresh-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 0;
  }

  .git-create,
  .git-match-note,
  .git-empty,
  .git-repo-empty {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 8px;
    padding: 9px 10px;
    border-radius: 10px;
    font-size: 0.68rem;
    line-height: 1.45;
  }

  .git-create {
    width: 100%;
    border: 1px solid color-mix(in srgb, var(--border-strong) 84%, transparent);
    background: color-mix(in srgb, var(--panel-2) 82%, var(--button-bg));
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }

  .git-create:hover:not(:disabled) {
    background: var(--surface-hover);
    border-color: var(--border-strong);
  }

  .git-create:focus-visible {
    background: var(--surface-hover);
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .git-create:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .git-create-label {
    font-family: var(--pi-font-mono);
    font-size: 0.68rem;
  }

  .git-match-note {
    background: color-mix(in srgb, var(--panel-2) 86%, transparent);
    color: var(--text-muted);
  }

  .git-empty {
    justify-content: center;
    color: var(--text-subtle);
    background: color-mix(in srgb, var(--panel-2) 70%, transparent);
  }

  .git-list {
    margin: 0;
    padding: 0 6px 0 0;
    list-style: none;
    max-height: 280px;
    overflow-y: auto;
    scrollbar-gutter: stable;
    scrollbar-width: none;
  }

  .git-list::-webkit-scrollbar {
    display: none;
  }

  .git-list:focus {
    outline: none;
  }

  .git-list-item + .git-list-item {
    margin-top: 3px;
  }

  .git-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 6px 10px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      transform 0.12s ease;
  }

  .git-option:hover:not(:disabled),
  .git-option.highlighted {
    background: var(--surface-hover);
    border-color: color-mix(in srgb, var(--border-strong) 84%, transparent);
    transform: translateX(1px);
  }

  .git-option.selected {
    background: var(--surface-selected);
    border-color: color-mix(in srgb, var(--accent) 24%, var(--border-strong));
  }

  .git-option:disabled {
    cursor: wait;
  }

  .git-option-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--pi-font-mono);
    font-size: 0.8rem;
    color: var(--text);
  }

  @media (max-width: 640px) {
    .git-menu {
      width: min(296px, calc(100vw - 24px));
    }
  }

  .spin {
    animation: git-spin 0.85s linear infinite;
  }

  @keyframes git-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  /* Grouped mode */

  .git-repo-group {
    margin-bottom: 6px;
    padding: 6px 6px 8px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel-2) 36%, transparent);
  }

  .git-list-grouped {
    padding: 0;
    overflow-y: auto;
  }

  .git-repo-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    padding: 4px 8px 6px;
    margin: 0 0 4px;
    border: none;
    border-bottom: 1px solid
      color-mix(in srgb, var(--border) 60%, transparent);
    border-radius: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease;
  }

  .git-repo-header:hover {
    background: var(--surface-hover);
  }

  .git-repo-chevron {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .git-repo-label {
    font-family: var(--pi-font-mono);
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text);
    letter-spacing: 0.01em;
  }

  .git-repo-meta {
    font-family: var(--pi-font-mono);
    font-size: 0.62rem;
    color: var(--text-subtle);
    font-style: italic;
  }

  .git-repo-branches {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .git-repo-empty {
    padding: 6px 8px;
    color: var(--text-subtle);
    font-style: italic;
    font-size: 0.66rem;
  }
</style>
