<script lang="ts">
  import type {
    RpcGitBranch,
    RpcGitRepoEntry,
    RpcGitRepoState,
  } from "@pi-web/bridge/types";
  import GitBranchIcon from "lucide-svelte/icons/git-branch";
  import Plus from "lucide-svelte/icons/plus";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";
  import GitBranchRepoGroup from "./GitBranchRepoGroup.svelte";
  import GitBranchSingleRepoList from "./GitBranchSingleRepoList.svelte";
  import { mergeBranchesFor } from "./gitBranchDropdownUtils";
  import {
    buildGroupedEntries,
    buildVisibleBranchEntries,
    findGroupedExactBranch,
    type GroupEntry,
  } from "./gitBranchDropdownDerived";
  import "./gitBranchDropdown.css";

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

  // ---------- Grouped-mode active repo + display label ----------
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
  let displayLabel = $derived.by(() => {
    if (!isGroupedMode) {
      const fb = repoState?.headLabel ?? label;
      const branch = fb?.trim();
      return branch ? branch : null;
    }
    if (activeGroupedRepoState?.headLabel && activeGroupedRepo) {
      const head = activeGroupedRepoState.headLabel.trim();
      if (head) return `${activeGroupedRepo.label}/${head}`;
    }
    if (activeGroupedRepo) return activeGroupedRepo.label;
    return label ?? null;
  });
  let triggerTitle = $derived.by(() => {
    if (!displayLabel) return "Git branch";
    if (!isGroupedMode && repoState?.isDirty)
      return `${displayLabel} (working tree has uncommitted changes)`;
    return displayLabel;
  });

  let isBusy = $derived(loading || switching);
  let rootRef = $state<HTMLElement | null>(null);
  let triggerRef = $state<HTMLButtonElement | null>(null);
  let listRef = $state<HTMLElement | null>(null);
  let isOpen = $state(false);
  let searchText = $state("");
  let highlightedIndex = $state(0);
  let groupedHighlightIndex = $state(0);

  // ---------- Single-repo mode derivations ----------
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

  // ---------- Grouped-mode derivations (delegated) ----------
  let groupedEntries = $derived.by(() =>
    isGroupedMode
      ? buildGroupedEntries(repos, repoStateByRoot, repoStateLoadingByRoot)
      : ([] as GroupEntry[]),
  );
  let visibleBranchEntries = $derived(
    buildVisibleBranchEntries(groupedEntries, searchText),
  );
  let groupedExactBranchMatch = $derived(
    isGroupedMode ? findGroupedExactBranch(groupedEntries, searchText) : null,
  );
  let groupedCanCreateBranch = $derived(
    Boolean(searchText.trim()) && !groupedExactBranchMatch,
  );
  let groupedCreateButtonLabel = $derived.by(() => {
    const q = searchText.trim();
    if (!q || !activeGroupedRepo) return "Create branch";
    return `Create on ${activeGroupedRepo.label}: ${q}`;
  });

  // Track which repo sections are expanded in grouped mode.
  let expandedRepoRoots = $state<Set<string>>(new Set());
  function isRepoExpanded(root: string): boolean {
    if (searchText.trim()) return true;
    return expandedRepoRoots.has(root);
  }
  function toggleRepoExpanded(root: string): void {
    const next = new Set(expandedRepoRoots);
    if (next.has(root)) next.delete(root);
    else next.add(root);
    expandedRepoRoots = next;
  }

  // ---------- Highlight sync + scroll ----------
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
      if (emi >= 0) { groupedHighlightIndex = emi; return; }
      const ci = visibleBranchEntries.findIndex(
        e => e.kind === "branch" && e.branch?.isCurrent,
      );
      groupedHighlightIndex = ci >= 0 ? ci : 0;
      return;
    }
    const list = filteredBranches;
    if (list.length === 0) { highlightedIndex = 0; return; }
    const emi = list.findIndex(b => b.name === searchText.trim());
    if (emi >= 0) { highlightedIndex = emi; return; }
    const ci = list.findIndex(b => b.isCurrent);
    highlightedIndex = ci >= 0 ? ci : 0;
  }

  function scrollToHighlighted() {
    queueMicrotask(() => {
      const idx = isGroupedMode ? groupedHighlightIndex : highlightedIndex;
      const target = listRef?.children[idx] as HTMLElement | undefined;
      target?.scrollIntoView({ block: "nearest" });
    });
  }

  function updateHighlight(nextIndex: number) {
    const list = isGroupedMode ? visibleBranchEntries : filteredBranches;
    const max = list.length - 1;
    const clamped = Math.min(Math.max(nextIndex, 0), max);
    if (isGroupedMode) groupedHighlightIndex = clamped;
    else highlightedIndex = clamped;
    scrollToHighlighted();
  }

  // ---------- Effects ----------
  // Auto-load branches for every known repo when the dropdown opens.
  $effect(() => {
    // Track length unconditionally so this effect re-fires when the repo
    // list grows from 1 to N (e.g. workspace switch reveals a nested repo).
    void repos.length;
    void repoStateByRoot;
    void repoStateLoadingByRoot;
    if (!isGroupedMode || !isOpen) return;
    for (const repo of repos) {
      if (!repoStateByRoot[repo.root] && !repoStateLoadingByRoot[repo.root]) {
        void refreshRepoState(repo.root, true).catch(() => {});
      }
    }
  });

  $effect(() => {
    if (typeof document === "undefined") return;
    if (isOpen) {
      const handler = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (!rootRef?.contains(target)) closeDropdown();
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
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

  // ---------- Handlers ----------
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

  async function handleRefresh(force = true) {
    if (isBusy) return;
    if (isGroupedMode) {
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
    if (branch.isCurrent) { closeDropdown({ focusTrigger: true }); return; }
    const nextState = await switchBranch(branch.name);
    if (nextState) closeDropdown({ focusTrigger: true });
  }

  async function handleCreateBranch() {
    if (!canCreateBranch || switching) return;
    const nextState = await createBranch(searchText.trim());
    if (nextState) closeDropdown({ focusTrigger: true });
  }

  async function handleGroupedBranchPick(
    repo: RpcGitRepoEntry,
    branch: RpcGitBranch,
  ) {
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

  function handleGroupedHighlightBranch(branch: RpcGitBranch) {
    if (!isGroupedMode) return;
    const flatIdx = visibleBranchEntries.findIndex(
      e => e.kind === "branch" && e.branch === branch,
    );
    if (flatIdx >= 0) groupedHighlightIndex = flatIdx;
  }

  // ---------- Keyboard ----------
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
              class="git-search-input"
              type="text"
              placeholder={isGroupedMode
                ? "Find or create branch (search all repos)"
                : "Find or create branch"}
              bind:value={searchText}
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
              <RefreshCw aria-hidden="true" size={14} />
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
                <GitBranchRepoGroup
                  {group}
                  isExpanded={isRepoExpanded(group.repo.root)}
                  isBranchHighlighted={(branch) => {
                    if (!isGroupedMode) return false;
                    const idx = visibleBranchEntries.findIndex(
                      e => e.kind === "branch" && e.branch === branch,
                    );
                    return idx >= 0 && idx === groupedHighlightIndex;
                  }}
                  {switching}
                  onToggleExpanded={toggleRepoExpanded}
                  onPickBranch={handleGroupedBranchPick}
                  onHighlightBranch={handleGroupedHighlightBranch}
                />
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
            <GitBranchSingleRepoList
              bind:listRef
              branches={filteredBranches}
              highlightedIndex={highlightedIndex}
              {switching}
              onSelect={selectBranch}
              onHighlight={(i) => (highlightedIndex = i)}
              onKeydown={handleSearchKeydown}
            />
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}