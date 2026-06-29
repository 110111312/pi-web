<script lang="ts">
  import type { RpcGitBranch, RpcGitRepoEntry, RpcGitRepoState } from "@pi-web/bridge/types";
  import Check from "lucide-svelte/icons/check";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import { branchDisplayName } from "./gitBranchDropdownUtils";

  let {
    group,
    isExpanded,
    isBranchHighlighted = () => false,
    switching = false,
    onToggleExpanded,
    onPickBranch,
    onHighlightBranch,
  } = $props<{
    group: {
      repo: RpcGitRepoEntry;
      state: RpcGitRepoState | null;
      loading: boolean;
      branches: RpcGitBranch[];
    };
    isExpanded: boolean;
    isBranchHighlighted?: (branch: RpcGitBranch) => boolean;
    switching?: boolean;
    onToggleExpanded: (root: string) => void;
    onPickBranch: (repo: RpcGitRepoEntry, branch: RpcGitBranch) => void;
    onHighlightBranch?: (branch: RpcGitBranch) => void;
  }>();
</script>

<li class="git-repo-group">
  <button
    type="button"
    class="git-repo-header"
    aria-expanded={isExpanded}
    onclick={() => onToggleExpanded(group.repo.root)}
  >
    {#if isExpanded}
      <ChevronDown class="git-repo-chevron" aria-hidden="true" size={12} />
    {:else}
      <ChevronRight class="git-repo-chevron" aria-hidden="true" size={12} />
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
  {#if isExpanded}
    {#if group.state === null && group.loading === false}
      <div class="git-repo-empty">No branches</div>
    {:else if !group.state && group.loading}
      <div class="git-repo-empty">Loading…</div>
    {:else if group.branches.length === 0}
      <div class="git-repo-empty">No branches</div>
    {:else}
      <ol class="git-repo-branches">
        {#each group.branches as branch (`${group.repo.root}:${branch.kind}:${branch.name}`)}
          <li class="git-list-item">
            <button
              class="git-option"
              type="button"
              class:highlighted={isBranchHighlighted(branch)}
              class:selected={branch.isCurrent}
              disabled={switching}
              onclick={() => onPickBranch(group.repo, branch)}
              onmouseenter={() => onHighlightBranch?.(branch)}
            >
              <span class="git-option-name">
                {branchDisplayName(branch)}
              </span>
              {#if branch.isCurrent}
                <Check class="git-option-check" aria-hidden="true" size={14} />
              {/if}
            </button>
          </li>
        {/each}
      </ol>
    {/if}
  {/if}
</li>