<script lang="ts">
  import type { RpcGitBranch } from "@pi-web/bridge/types";
  import Check from "lucide-svelte/icons/check";
  import { branchDisplayName } from "./gitBranchDropdownUtils";

  let {
    branches,
    highlightedIndex,
    switching,
    onSelect,
    onHighlight,
    onKeydown,
    listRef = $bindable(null),
  } = $props<{
    branches: readonly RpcGitBranch[];
    highlightedIndex: number;
    switching: boolean;
    onSelect: (branch: RpcGitBranch) => void;
    onHighlight: (index: number) => void;
    onKeydown: (event: KeyboardEvent) => void;
    listRef?: HTMLElement | null;
  }>();
</script>

<ul
  bind:this={listRef}
  class="git-list"
  role="listbox"
  tabindex="-1"
  {onkeydown}
>
  {#each branches as branch, index (`${branch.kind}:${branch.name}`)}
    <li class="git-list-item">
      <button
        class="git-option"
        type="button"
        class:highlighted={index === highlightedIndex}
        class:selected={branch.isCurrent}
        disabled={switching}
        onclick={() => onSelect(branch)}
        onmouseenter={() => onHighlight(index)}
      >
        <span class="git-option-name">{branchDisplayName(branch)}</span>
        {#if branch.isCurrent}
          <Check class="git-option-check" aria-hidden="true" size={14} />
        {/if}
      </button>
    </li>
  {/each}
</ul>