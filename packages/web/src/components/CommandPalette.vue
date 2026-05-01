<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import type { SlashCommandOption } from "../utils/slashCommands";

const props = defineProps<{
  commands: SlashCommandOption[];
  filter: string;
}>();

const emit = defineEmits<{
  select: [commandName: string];
  close: [];
}>();

const highlightedIndex = ref(0);
const listRef = ref<HTMLElement | null>(null);

const filtered = computed(() => {
  const q = props.filter.toLowerCase();
  if (!q) return props.commands;
  return props.commands.filter(
    c =>
      c.name.toLowerCase().includes(q) ||
      (c.description ?? "").toLowerCase().includes(q),
  );
});

watch(
  () => props.filter,
  () => {
    highlightedIndex.value = 0;
  },
);

function handleKeydown(e: KeyboardEvent) {
  if (filtered.value.length === 0) {
    if (e.key === "Escape") emit("close");
    return;
  }

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      highlightedIndex.value =
        (highlightedIndex.value + 1) % filtered.value.length;
      scrollToHighlighted();
      break;
    case "ArrowUp":
      e.preventDefault();
      highlightedIndex.value =
        (highlightedIndex.value - 1 + filtered.value.length) %
        filtered.value.length;
      scrollToHighlighted();
      break;
    case "Enter":
      e.preventDefault();
      if (filtered.value[highlightedIndex.value]) {
        emit("select", filtered.value[highlightedIndex.value].name);
      }
      break;
    case "Escape":
      e.preventDefault();
      emit("close");
      break;
  }
}

function scrollToHighlighted() {
  nextTick(() => {
    const el = listRef.value?.children[highlightedIndex.value] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({ block: "nearest" });
  });
}

function handleClick(cmd: SlashCommandOption) {
  emit("select", cmd.name);
}

defineExpose({ handleKeydown });
</script>

<template>
  <div v-if="filtered.length > 0" class="command-palette">
    <ul ref="listRef" class="command-list">
      <li
        v-for="(cmd, idx) in filtered"
        :key="cmd.name"
        class="command-item"
        :class="{ highlighted: idx === highlightedIndex }"
        @click="handleClick(cmd)"
        @mouseenter="highlightedIndex = idx"
      >
        <div class="command-copy">
          <span class="cmd-name">/{{ cmd.name }}</span>
          <span v-if="cmd.description" class="cmd-desc">{{
            cmd.description
          }}</span>
        </div>
      </li>
    </ul>
  </div>
  <div v-else class="command-palette empty">
    <span class="empty-text">No matching commands</span>
  </div>
</template>

<style scoped>
.command-palette {
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

.command-palette::-webkit-scrollbar {
  display: none;
}

.command-palette.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

.command-list {
  list-style: none;
  margin: 0;
  padding: 6px;
}

.command-item {
  display: flex;
  align-items: center;
  min-height: 38px;
  padding: 8px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.1s ease;
}

.command-item:hover,
.command-item.highlighted {
  background: var(--panel-2);
}

.command-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cmd-name {
  font-size: 0.78rem;
  color: var(--text);
  white-space: nowrap;
}

.cmd-desc {
  font-size: 0.72rem;
  color: var(--text-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-text {
  font-size: 0.76rem;
  color: var(--text-subtle);
}
</style>
