<script setup lang="ts">
import type { RpcGitBranch, RpcGitRepoState } from "@pi-web/bridge/types";
import {
  Check,
  ChevronDown,
  GitBranch,
  LoaderCircle,
  Plus,
  RefreshCw,
} from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{
  label: string | null;
  repoState: RpcGitRepoState | null;
  loading: boolean;
  switching: boolean;
  disabled?: boolean;
  refresh: (force?: boolean) => Promise<RpcGitRepoState | null>;
  switchBranch: (branchName: string) => Promise<RpcGitRepoState | null>;
  createBranch: (branchName: string) => Promise<RpcGitRepoState | null>;
}>();

const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const searchText = ref("");
const highlightedIndex = ref(0);

const displayLabel = computed(() => {
  const fallback = props.repoState?.headLabel ?? props.label;
  const branch = fallback?.trim();
  return branch ? branch : null;
});
const isBusy = computed(() => props.loading || props.switching);
const normalizedQuery = computed(() => searchText.value.trim());

/** Merge local and remote branches that share the same shortName.
 *  Local branch takes precedence; remote-only branches are kept separately. */
const mergedBranches = computed((): RpcGitBranch[] => {
  if (!props.repoState) return [];

  const byShortName = new Map<
    string,
    { local?: RpcGitBranch; remotes: RpcGitBranch[] }
  >();

  for (const branch of props.repoState.branches) {
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

  // Preserve original order (current first, then local, then remote)
  for (const branch of props.repoState.branches) {
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
});

const filteredBranches = computed(() => {
  if (!props.repoState) return [];
  const query = normalizedQuery.value.toLowerCase();
  if (!query) return mergedBranches.value;
  return mergedBranches.value.filter(branch => {
    const display =
      branch.kind === "remote" && branch.remoteName
        ? `${branch.remoteName}/${branch.shortName}`
        : branch.shortName;
    const haystack = [branch.name, display].join(" ").toLowerCase();
    return haystack.includes(query);
  });
});
const exactBranchMatch = computed(() => {
  const query = normalizedQuery.value;
  if (!query) return null;
  return mergedBranches.value.find(branch => branch.name === query) ?? null;
});
const canCreateBranch = computed(() => {
  const query = normalizedQuery.value;
  return Boolean(query) && !exactBranchMatch.value;
});
const createButtonLabel = computed(() => {
  if (!normalizedQuery.value) return "Create branch";
  return `Create ${normalizedQuery.value}`;
});
const triggerTitle = computed(() => {
  if (!displayLabel.value) return "Git branch";
  if (props.repoState?.isDirty) {
    return `${displayLabel.value} (working tree has uncommitted changes)`;
  }
  return displayLabel.value;
});
const showSearch = computed(() =>
  mergedBranches.value.length
    ? mergedBranches.value.length > 8 || searchText.value.length > 0
    : searchText.value.length > 0,
);

function branchDisplayName(branch: RpcGitBranch): string {
  if (branch.kind === "remote" && branch.remoteName) {
    return `${branch.remoteName}/${branch.shortName}`;
  }
  return branch.shortName;
}

function syncHighlightedIndex() {
  if (filteredBranches.value.length === 0) {
    highlightedIndex.value = 0;
    return;
  }

  const exactMatchIndex = filteredBranches.value.findIndex(
    branch => branch.name === normalizedQuery.value,
  );
  if (exactMatchIndex >= 0) {
    highlightedIndex.value = exactMatchIndex;
    return;
  }

  const currentIndex = filteredBranches.value.findIndex(
    branch => branch.isCurrent,
  );
  highlightedIndex.value = currentIndex >= 0 ? currentIndex : 0;
}

function scrollToHighlighted() {
  nextTick(() => {
    const element = listRef.value?.children[highlightedIndex.value] as
      | HTMLElement
      | undefined;
    element?.scrollIntoView({ block: "nearest" });
  });
}

async function ensureRepoState(force = false) {
  await props.refresh(force);
  syncHighlightedIndex();
  scrollToHighlighted();
}

async function openDropdown() {
  if (props.disabled || !displayLabel.value) return;
  isOpen.value = true;
  searchText.value = "";
  syncHighlightedIndex();
  await nextTick();
  if (props.repoState || props.loading) {
    searchInputRef.value?.focus();
  } else {
    listRef.value?.focus();
  }
  if (!props.repoState && !props.loading) {
    void ensureRepoState(true);
  } else {
    scrollToHighlighted();
  }
}

function closeDropdown(options?: { focusTrigger?: boolean }) {
  isOpen.value = false;
  searchText.value = "";
  if (options?.focusTrigger) {
    nextTick(() => {
      triggerRef.value?.focus();
    });
  }
}

function toggleDropdown() {
  if (isOpen.value) {
    closeDropdown();
    return;
  }
  void openDropdown();
}

function updateHighlight(nextIndex: number) {
  const maxIndex = filteredBranches.value.length - 1;
  highlightedIndex.value = Math.min(Math.max(nextIndex, 0), maxIndex);
  scrollToHighlighted();
}

async function handleRefresh(force = true) {
  if (isBusy.value) return;
  await ensureRepoState(force);
}

async function selectBranch(branch: RpcGitBranch) {
  if (props.switching) return;
  if (branch.isCurrent) {
    closeDropdown({ focusTrigger: true });
    return;
  }

  const nextState = await props.switchBranch(branch.name);
  if (nextState) {
    closeDropdown({ focusTrigger: true });
  }
}

async function handleCreateBranch() {
  if (!canCreateBranch.value || props.switching) return;

  const nextState = await props.createBranch(normalizedQuery.value);
  if (nextState) {
    closeDropdown({ focusTrigger: true });
  }
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (props.disabled || !displayLabel.value) return;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      if (!isOpen.value) {
        void openDropdown();
        return;
      }
      updateHighlight(highlightedIndex.value + 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      if (!isOpen.value) {
        void openDropdown();
        return;
      }
      updateHighlight(highlightedIndex.value - 1);
      break;
    case "Enter":
    case " ":
      event.preventDefault();
      toggleDropdown();
      break;
  }
}

function handleSearchKeydown(event: KeyboardEvent) {
  if (!isOpen.value) return;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      if (filteredBranches.value.length > 0) {
        updateHighlight(
          (highlightedIndex.value + 1) % filteredBranches.value.length,
        );
      }
      break;
    case "ArrowUp":
      event.preventDefault();
      if (filteredBranches.value.length > 0) {
        updateHighlight(
          (highlightedIndex.value - 1 + filteredBranches.value.length) %
            filteredBranches.value.length,
        );
      }
      break;
    case "Enter": {
      event.preventDefault();
      if (canCreateBranch.value) {
        void handleCreateBranch();
        return;
      }
      const branch = filteredBranches.value[highlightedIndex.value];
      if (branch) {
        void selectBranch(branch);
      }
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
  if (!rootRef.value?.contains(target)) {
    closeDropdown();
  }
}

watch(isOpen, open => {
  if (typeof document === "undefined") return;
  if (open) {
    document.addEventListener("mousedown", handleDocumentMousedown);
    return;
  }
  document.removeEventListener("mousedown", handleDocumentMousedown);
});

watch(filteredBranches, () => {
  if (highlightedIndex.value >= filteredBranches.value.length) {
    highlightedIndex.value = Math.max(0, filteredBranches.value.length - 1);
  }
  scrollToHighlighted();
});

watch(
  () => props.repoState,
  async repoState => {
    if (!isOpen.value) return;
    syncHighlightedIndex();
    await nextTick();
    if (repoState && !props.loading) {
      searchInputRef.value?.focus();
    }
    scrollToHighlighted();
  },
);

onBeforeUnmount(() => {
  if (typeof document !== "undefined") {
    document.removeEventListener("mousedown", handleDocumentMousedown);
  }
});
</script>

<template>
  <div v-if="displayLabel" ref="rootRef" class="git-dropdown">
    <button
      ref="triggerRef"
      class="git-trigger"
      :type="'button'"
      :disabled="disabled || isBusy"
      :title="triggerTitle"
      :aria-expanded="isOpen"
      aria-haspopup="dialog"
      @click="toggleDropdown"
      @keydown="handleTriggerKeydown"
    >
      <GitBranch class="git-trigger-icon" aria-hidden="true" />
      <span class="git-trigger-text">{{ displayLabel }}</span>
      <LoaderCircle
        v-if="isBusy"
        class="git-trigger-spinner spin"
        aria-hidden="true"
      />
      <ChevronDown v-else class="git-trigger-caret" aria-hidden="true" />
    </button>

    <div v-if="isOpen" class="git-menu">
      <div class="git-search-row">
        <label class="git-search">
          <input
            ref="searchInputRef"
            v-model="searchText"
            class="git-search-input"
            type="text"
            placeholder="Find or create branch"
            @keydown="handleSearchKeydown"
          />
        </label>
        <button
          class="git-refresh"
          :type="'button'"
          :disabled="isBusy"
          title="Refresh branches"
          @click="handleRefresh(true)"
        >
          <RefreshCw
            class="git-refresh-icon"
            :class="{ spin: loading }"
            aria-hidden="true"
          />
        </button>
      </div>

      <button
        v-if="repoState && canCreateBranch"
        class="git-create"
        :type="'button'"
        :disabled="switching"
        @click="handleCreateBranch"
      >
        <Plus class="git-create-icon" aria-hidden="true" />
        <span class="git-create-label">{{ createButtonLabel }}</span>
      </button>
      <div v-else-if="repoState && exactBranchMatch" class="git-match-note">
        Branch already exists. Press Enter to switch.
      </div>

      <div v-if="loading && !repoState" class="git-empty">
        Loading branches...
      </div>
      <div v-else-if="!repoState" class="git-empty">
        No git repository found.
      </div>
      <div v-else-if="filteredBranches.length === 0" class="git-empty">
        No matching branches
      </div>
      <ul
        v-else
        ref="listRef"
        class="git-list"
        tabindex="-1"
        @keydown="handleSearchKeydown"
      >
        <li
          v-for="(branch, index) in filteredBranches"
          :key="branch.kind + ':' + branch.name"
          class="git-list-item"
        >
          <button
            class="git-option"
            :type="'button'"
            :class="{
              highlighted: index === highlightedIndex,
              selected: branch.isCurrent,
            }"
            :disabled="switching"
            @click="selectBranch(branch)"
            @mouseenter="highlightedIndex = index"
          >
            <span class="git-option-name">{{ branchDisplayName(branch) }}</span>
            <Check
              v-if="branch.isCurrent"
              class="git-option-check"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
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
  border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  background: color-mix(in srgb, var(--panel) 60%, transparent);
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.git-trigger:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--surface-hover);
  color: var(--text);
}

.git-trigger[aria-expanded="true"] {
  border-color: color-mix(in srgb, var(--accent) 36%, var(--border-strong));
  background: var(--surface-active);
  color: var(--text);
}

.git-trigger:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring);
  color: var(--text);
}

.git-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.git-trigger-icon,
.git-trigger-caret,
.git-trigger-spinner {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--text-subtle);
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
  width: min(332px, calc(100vw - 48px));
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
  align-items: center;
  gap: 7px;
  margin-bottom: 6px;
}

.git-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
  color: var(--text-subtle);
  cursor: pointer;
  flex-shrink: 0;
}

.git-refresh:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--surface-hover);
  color: var(--text);
}

.git-refresh:focus-visible {
  border-color: var(--accent);
  background: var(--surface-hover);
  color: var(--text);
  outline: none;
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.git-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.git-refresh-icon,
.git-option-check,
.git-create-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
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
  border-color: var(--accent);
  background: var(--panel);
  box-shadow: 0 0 0 3px var(--focus-ring);
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

.git-create,
.git-match-note,
.git-empty {
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

.git-option-check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-muted);
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
</style>
