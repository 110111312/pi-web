<script setup lang="ts">
import type { RpcWorkspaceFile } from "@pi-web/bridge/types";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { highlightCodeLinesHtml } from "../utils/codeHighlight";

const props = defineProps<{
  filePath: string;
  lineNumber: number;
  readWorkspaceFile: (path: string) => Promise<RpcWorkspaceFile>;
}>();

const container = ref<HTMLDivElement | null>(null);
const file = ref<RpcWorkspaceFile | null>(null);
const renderedHtml = ref("");
const loading = ref(false);
const errorMessage = ref("");
let loadVersion = 0;
let renderVersion = 0;
let themeObserver: MutationObserver | undefined;

const activeLineNumber = computed(() =>
  Number.isInteger(props.lineNumber) && props.lineNumber > 0
    ? props.lineNumber
    : 1,
);

async function loadFile() {
  const version = ++loadVersion;
  loading.value = true;
  errorMessage.value = "";
  file.value = null;
  renderedHtml.value = "";

  try {
    const nextFile = await props.readWorkspaceFile(props.filePath);
    if (version !== loadVersion) {
      return;
    }
    file.value = nextFile;
  } catch (error) {
    if (version !== loadVersion) {
      return;
    }
    file.value = null;
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to load file preview";
    renderedHtml.value = "";
  } finally {
    if (version === loadVersion) {
      loading.value = false;
    }
  }
}

async function scrollToActiveLine() {
  await nextTick();

  const root = container.value;
  if (!root) {
    return;
  }

  const target = root.querySelector<HTMLElement>(
    `[data-line="${activeLineNumber.value}"]`,
  );
  if (!target) {
    return;
  }

  target.scrollIntoView({ block: "center" });
}

async function renderCode() {
  const version = ++renderVersion;
  if (!file.value) {
    renderedHtml.value = "";
    return;
  }

  const html = await highlightCodeLinesHtml(
    file.value.content,
    file.value.path,
    undefined,
    activeLineNumber.value,
  );
  if (version !== renderVersion) {
    return;
  }

  renderedHtml.value = html;
  await scrollToActiveLine();
}

onMounted(() => {
  const shell = document.querySelector(".app-shell");
  if (!shell) {
    return;
  }

  themeObserver = new MutationObserver(() => {
    void renderCode();
  });
  themeObserver.observe(shell, {
    attributes: true,
    attributeFilter: ["data-dark-theme", "data-light-theme"],
  });
});

onBeforeUnmount(() => {
  loadVersion += 1;
  renderVersion += 1;
  themeObserver?.disconnect();
});

watch(
  () => props.filePath,
  () => {
    void loadFile();
  },
  { immediate: true },
);

watch(
  () => [file.value?.content, file.value?.path, activeLineNumber.value],
  () => {
    void renderCode();
  },
  { immediate: true },
);
</script>

<template>
  <section class="file-viewer-panel">
    <div v-if="errorMessage" class="file-viewer-state error">
      {{ errorMessage }}
    </div>
    <div v-else-if="loading && !file" class="file-viewer-state">
      Loading file...
    </div>
    <template v-else>
      <div v-if="file?.truncated" class="file-viewer-notice">
        Showing the first {{ file.lineCount }} lines. The full file is
        {{ file.totalBytes }} bytes.
      </div>
      <div ref="container" class="file-viewer-code-shell">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div
          v-if="renderedHtml"
          class="file-viewer-code"
          v-html="renderedHtml"
        ></div>
        <div v-else class="file-viewer-empty">This file is empty.</div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.file-viewer-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--rail-bg);
}

.file-viewer-state,
.file-viewer-notice,
.file-viewer-empty {
  margin: 10px 14px 0;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 0.74rem;
  line-height: 1.5;
}

.file-viewer-state,
.file-viewer-empty {
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  background: color-mix(in srgb, var(--panel) 84%, transparent);
  color: var(--text-muted);
}

.file-viewer-state.error {
  border-color: color-mix(in srgb, var(--danger) 38%, var(--border));
  background: color-mix(in srgb, var(--error-bg) 72%, transparent);
  color: var(--error-text);
}

.file-viewer-notice {
  border: 1px solid color-mix(in srgb, var(--warning) 32%, var(--border));
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  color: var(--text-muted);
}

.file-viewer-code-shell {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border-top: 1px solid var(--border);
  scrollbar-width: none;
}

.file-viewer-code-shell::-webkit-scrollbar {
  display: none;
}

.file-viewer-code {
  min-width: max-content;
  padding-bottom: 4px;
}

.file-viewer-code :deep(pre) {
  margin: 0;
  padding: 2px 0 6px;
  overflow: visible;
}

.file-viewer-code :deep(code) {
  display: block;
  min-width: max-content;
  font-family: var(--pi-font-mono);
  font-size: 0.72rem;
  line-height: 1.35;
  white-space: normal;
}

.file-viewer-code :deep(.code-line) {
  display: block;
  position: relative;
  padding: 0 14px 0 62px;
  white-space: pre;
  line-height: 1.35;
  background: transparent;
}

.file-viewer-code :deep(.code-line:empty)::after {
  content: " ";
  visibility: hidden;
}

.file-viewer-code :deep(.code-line)::before {
  content: attr(data-line);
  position: absolute;
  top: 0;
  left: 0;
  width: 50px;
  padding-right: 12px;
  border-right: 1px solid var(--border);
  color: var(--text-subtle);
  text-align: right;
  line-height: 1.35;
  user-select: none;
}

.file-viewer-code :deep(.code-line-target) {
  background: var(--surface-active);
}

.file-viewer-code :deep(.code-line-target)::before {
  color: var(--accent-hover);
  background: var(--surface-active);
}

@media (max-width: 900px) {
  .file-viewer-state,
  .file-viewer-notice,
  .file-viewer-empty {
    margin-inline: 12px;
  }
}
</style>
