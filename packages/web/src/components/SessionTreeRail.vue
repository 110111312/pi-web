<script setup lang="ts">
import { PanelRightClose, RefreshCw } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import type { TreeEntry } from "../composables/useBridgeClient";
import {
  filterTreeEntries,
  getTreeEntryDisplayParts,
  type TreeFilterMode,
} from "../utils/treeOutline";

const props = defineProps<{
  entries: readonly TreeEntry[];
  sessionLabel: string;
  sessionPath: string | null;
  showCollapseToggle?: boolean;
}>();

const emit = defineEmits<{
  select: [entryId: string];
  refresh: [];
  toggleCollapse: [];
}>();

const query = ref("");
const filterMode = ref<TreeFilterMode>("default");

const filterOptions: Array<{ mode: TreeFilterMode; label: string }> = [
  { mode: "default", label: "Default" },
  { mode: "no-tools", label: "No tools" },
  { mode: "user-only", label: "User" },
  { mode: "labeled-only", label: "Labels" },
  { mode: "all", label: "All" },
];

watch(
  () => props.sessionPath,
  () => {
    query.value = "";
    filterMode.value = "default";
  },
);

const filteredEntries = computed(() =>
  filterTreeEntries(props.entries, filterMode.value, query.value),
);

function displayParts(entry: TreeEntry) {
  return getTreeEntryDisplayParts(entry);
}

function handleSelect(entryId: string) {
  emit("select", entryId);
}
</script>

<template>
  <div class="tree-rail">
    <header class="tree-header">
      <div class="header-main">
        <button
          v-if="showCollapseToggle"
          class="nav-button collapse-toggle"
          type="button"
          aria-label="Collapse outline"
          title="Collapse outline"
          @click="emit('toggleCollapse')"
        >
          <PanelRightClose aria-hidden="true" />
        </button>
        <div class="header-copy">
          <p class="header-kicker">Session outline</p>
          <h2 class="header-title">{{ sessionLabel }}</h2>
        </div>
      </div>
      <button
        class="nav-button"
        type="button"
        aria-label="Refresh outline"
        title="Refresh outline"
        @click="emit('refresh')"
      >
        <RefreshCw aria-hidden="true" />
      </button>
    </header>

    <div class="tree-toolbar">
      <input
        v-model="query"
        class="search-input"
        type="search"
        placeholder="Search..."
      />
      <div class="filter-row">
        <button
          v-for="option in filterOptions"
          :key="option.mode"
          class="filter-chip"
          :class="{ active: filterMode === option.mode }"
          type="button"
          @click="filterMode = option.mode"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <ol v-if="filteredEntries.length > 0" class="tree-list">
      <li v-for="entry in filteredEntries" :key="entry.id" class="tree-row">
        <button
          class="tree-item"
          :class="[
            `role-${displayParts(entry).role}`,
            {
              active: entry.isActive,
              'in-path': entry.isOnActivePath,
              dimmed: !entry.isOnActivePath,
            },
          ]"
          type="button"
          :title="displayParts(entry).title"
          @click="handleSelect(entry.id)"
        >
          <span class="tree-guides" aria-hidden="true">
            <span
              v-for="(column, index) in entry.trackColumns ?? []"
              :key="`${entry.id}-${index}`"
              class="track-column"
              :class="column"
            ></span>
          </span>
          <span class="tree-content">
            <span class="tree-marker" aria-hidden="true"></span>
            <span class="tree-line">
              <span class="tree-role">{{ displayParts(entry).roleLabel }}</span>
              <span v-if="displayParts(entry).labelTag" class="tree-tag">
                [{{ displayParts(entry).labelTag }}]
              </span>
              <span class="tree-preview">{{
                displayParts(entry).previewText
              }}</span>
            </span>
          </span>
        </button>
      </li>
    </ol>
    <div v-else class="empty-state">
      <p class="empty-title">No matching tree entries</p>
      <p class="empty-copy">Try another filter or search term.</p>
    </div>
  </div>
</template>

<style scoped>
.tree-rail {
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

.tree-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 2px 4px 8px;
}

.header-main {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-button {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  color: var(--text-subtle);
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease,
    transform 0.12s ease;
}

.nav-button:hover {
  background: var(--surface-hover);
  border-color: var(--border-strong);
  color: var(--text);
  transform: translateY(-1px);
}

.nav-button:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.nav-button svg {
  width: 14px;
  height: 14px;
}

.collapse-toggle {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}

.header-copy {
  min-width: 0;
}

.filter-chip {
  font-size: 0.56rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.header-kicker {
  display: none;
}

.header-title {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 3px 6px;
}

.search-input {
  height: 26px;
  width: 100%;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  color: var(--text);
  padding: 0 8px;
  font-size: 0.73rem;
  outline: none;
}

.search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.filter-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 3px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 1px;
  scrollbar-width: none;
}

.filter-row::-webkit-scrollbar {
  display: none;
}

.filter-chip {
  height: 22px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-subtle);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}

.filter-chip:hover {
  background: var(--surface-hover);
  border-color: var(--border-strong);
  color: var(--text-muted);
}

.filter-chip.active {
  background: var(--surface-selected);
  border-color: color-mix(in srgb, var(--accent) 24%, var(--border-strong));
  color: var(--text);
}

.tree-list {
  list-style: none;
  margin: 0;
  padding: 0 1px 0 3px;
  overflow-y: auto;
  flex: 1;
  scrollbar-width: none;
}

.tree-list::-webkit-scrollbar {
  display: none;
}

.tree-row + .tree-row {
  margin-top: 0;
}

.tree-item {
  width: 100%;
  min-height: 20px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 5px;
  align-items: center;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 5px;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  box-shadow: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: opacity 0.12s ease;
}

.tree-content {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 5px;
  align-items: center;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 5px;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}

.tree-item:hover .tree-content {
  background: var(--surface-hover);
}

.tree-item.dimmed {
  opacity: 0.46;
}

.tree-item.in-path {
  opacity: 1;
  background: transparent;
}

.tree-item.active {
  border-color: transparent;
}

.tree-item.active .tree-content {
  background: var(--surface-active);
  border-color: color-mix(in srgb, var(--accent) 24%, var(--border-strong));
  box-shadow: none;
}

.tree-guides {
  display: inline-flex;
  align-items: stretch;
  height: 16px;
}

.track-column {
  position: relative;
  width: 9px;
  flex-shrink: 0;
}

.track-column.line::before,
.track-column.branch::before,
.track-column.branch-last::before {
  content: "";
  position: absolute;
  left: 50%;
  width: 1px;
  background: color-mix(in srgb, var(--border) 82%, transparent);
  transform: translateX(-50%);
}

.track-column.line::before,
.track-column.branch::before {
  top: -7px;
  bottom: -7px;
}

.track-column.branch-last::before {
  top: -7px;
  height: calc(50% + 1px);
}

.track-column.branch::after,
.track-column.branch-last::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 7px;
  height: 1px;
  background: color-mix(in srgb, var(--border) 82%, transparent);
}

.tree-marker {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border-strong) 86%, transparent);
  flex-shrink: 0;
  transition:
    background 0.12s ease,
    box-shadow 0.12s ease,
    transform 0.12s ease;
}

.tree-item.in-path .tree-marker {
  background: color-mix(in srgb, var(--text-muted) 84%, var(--text));
}

.tree-item.role-user .tree-marker {
  background: var(--text);
}

.tree-item.active .tree-marker {
  background: color-mix(in srgb, var(--diff-added-accent) 54%, var(--text));
  box-shadow: none;
  transform: none;
}

.tree-line {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 4px;
  overflow: hidden;
  font-family: var(--pi-font-mono);
  font-size: 0.68rem;
  line-height: 1.05;
}

.tree-role {
  flex-shrink: 0;
  color: var(--text-subtle);
}

.tree-role::after {
  content: ":";
}

.tree-preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.tree-tag {
  flex-shrink: 0;
  max-width: 6.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: color-mix(in srgb, var(--text-subtle) 78%, var(--text));
  font-size: 0.61rem;
  line-height: 1.05;
}

.tree-item.active .tree-preview,
.tree-item.active .tree-role,
.tree-item.role-user .tree-preview,
.tree-item.role-user .tree-role {
  color: var(--text);
}

.tree-item.active .tree-tag {
  color: color-mix(in srgb, var(--text) 82%, var(--text-subtle));
}

.tree-item.role-assistant .tree-role {
  color: color-mix(in srgb, var(--text-subtle) 68%, var(--diff-added-accent));
}

.tree-item.role-tool .tree-role {
  color: color-mix(in srgb, var(--text-subtle) 88%, var(--border-strong));
}

.tree-item.role-meta .tree-role {
  color: color-mix(in srgb, var(--text-subtle) 76%, var(--text-muted));
}

.empty-state {
  margin: 6px 4px 0;
  padding: 12px 10px;
  border-radius: 9px;
  border: 1px dashed var(--border-strong);
  background: color-mix(in srgb, var(--panel) 58%, transparent);
}

.empty-title {
  margin: 0 0 3px;
  font-size: 0.78rem;
  color: var(--text);
}

.empty-copy {
  margin: 0;
  font-size: 0.71rem;
  line-height: 1.4;
  color: var(--text-subtle);
}

@media (max-width: 640px) {
  .tree-rail {
    padding: 12px 10px max(10px, env(safe-area-inset-bottom));
  }

  .tree-header {
    gap: 10px;
    padding: 4px 2px 12px;
  }

  .header-kicker {
    display: block;
    margin: 0 0 4px;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-subtle);
  }

  .header-title {
    font-size: 0.92rem;
    line-height: 1.25;
    white-space: normal;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .nav-button {
    width: 32px;
    height: 32px;
  }

  .tree-toolbar {
    gap: 8px;
    padding: 0 2px 10px;
  }

  .search-input {
    height: 36px;
    border-radius: 10px;
    padding: 0 12px;
    font-size: 0.9rem;
  }

  .filter-row {
    flex-wrap: wrap;
    gap: 6px;
    overflow: visible;
    padding-bottom: 0;
  }

  .filter-chip {
    height: 30px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 0.65rem;
  }

  .tree-list {
    padding: 0 1px 0 2px;
  }

  .tree-item {
    min-height: 32px;
    gap: 6px;
    align-items: flex-start;
    padding: 3px 2px;
  }

  .tree-content {
    gap: 8px;
    align-items: flex-start;
    padding: 6px 8px;
    border-radius: 8px;
  }

  .tree-guides {
    min-height: 24px;
    height: 100%;
    padding-top: 7px;
  }

  .tree-line {
    flex-wrap: wrap;
    row-gap: 2px;
    font-size: 0.78rem;
    line-height: 1.25;
  }

  .tree-tag {
    max-width: 100%;
  }

  .tree-preview {
    flex-basis: 100%;
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    overflow-wrap: anywhere;
  }

  .empty-state {
    margin: 8px 2px 0;
    padding: 14px 12px;
  }
}
</style>
