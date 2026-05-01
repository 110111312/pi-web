<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { WorkspaceMentionSuggestion } from "../utils/workspaceMentions";

const props = defineProps<
  {
    items: readonly WorkspaceMentionSuggestion[];
    loading: boolean;
  } & {
    emptyText?: string;
  }
>();

const emit = defineEmits<{
  select: [item: WorkspaceMentionSuggestion];
  close: [];
}>();

const highlightedIndex = ref(0);
const listRef = ref<HTMLElement | null>(null);

const hasItems = computed(() => props.items.length > 0);
const emptyLabel = computed(() => props.emptyText ?? "No matching files");

watch(
  () => props.items,
  () => {
    highlightedIndex.value = 0;
  },
);

function scrollToHighlighted() {
  nextTick(() => {
    const el = listRef.value?.children[highlightedIndex.value] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({ block: "nearest" });
  });
}

function handleSelect(item: WorkspaceMentionSuggestion | undefined) {
  if (!item) return;
  emit("select", item);
}

function handleKeydown(event: KeyboardEvent) {
  if (props.loading) {
    if (event.key === "Escape") {
      event.preventDefault();
      emit("close");
    }
    return;
  }

  if (!hasItems.value) {
    if (event.key === "Escape") {
      event.preventDefault();
      emit("close");
    }
    return;
  }

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      highlightedIndex.value =
        (highlightedIndex.value + 1) % props.items.length;
      scrollToHighlighted();
      break;
    case "ArrowUp":
      event.preventDefault();
      highlightedIndex.value =
        (highlightedIndex.value - 1 + props.items.length) % props.items.length;
      scrollToHighlighted();
      break;
    case "Enter":
    case "Tab":
      event.preventDefault();
      handleSelect(props.items[highlightedIndex.value]);
      break;
    case "Escape":
      event.preventDefault();
      emit("close");
      break;
  }
}

defineExpose({ handleKeydown });
</script>

<template>
  <div class="workspace-palette">
    <div v-if="loading" class="workspace-palette-empty">
      <span class="workspace-empty-text">Indexing workspace...</span>
    </div>
    <ul v-else-if="hasItems" ref="listRef" class="workspace-list">
      <li
        v-for="(item, idx) in items"
        :key="`${item.kind}:${item.path}`"
        class="workspace-item"
        :class="{ highlighted: idx === highlightedIndex }"
        @click="handleSelect(item)"
        @mouseenter="highlightedIndex = idx"
      >
        <div class="workspace-copy">
          <span class="workspace-name">{{ item.label }}</span>
          <span class="workspace-path">{{ item.description }}</span>
        </div>
      </li>
    </ul>
    <div v-else class="workspace-palette-empty">
      <span class="workspace-empty-text">{{ emptyLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.workspace-palette {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  max-height: 320px;
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow);
  z-index: 10;
  scrollbar-width: none;
}

.workspace-palette::-webkit-scrollbar {
  display: none;
}

.workspace-list {
  list-style: none;
  margin: 0;
  padding: 6px;
}

.workspace-item {
  display: flex;
  align-items: center;
  min-height: 42px;
  padding: 8px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.1s ease;
}

.workspace-item:hover,
.workspace-item.highlighted {
  background: var(--panel-2);
}

.workspace-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.workspace-name,
.workspace-path {
  font-family: var(--pi-font-mono);
}

.workspace-empty-text {
  font-family: var(--pi-font-sans);
}

.workspace-name {
  font-size: 0.74rem;
  color: var(--text);
  white-space: nowrap;
}

.workspace-path {
  font-size: 0.68rem;
  color: var(--text-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-palette-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

.workspace-empty-text {
  font-size: 0.72rem;
  color: var(--text-subtle);
}
</style>
