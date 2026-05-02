<script setup lang="ts">
import type { RpcImageContent } from "@pi-web/bridge/types";
import { Pencil, Sparkle } from "lucide-vue-next";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { TranscriptEntry } from "../composables/useBridgeClient";
import { userMessageCopyText } from "../utils/messageCopy";
import { buildToolDetailModel, buildToolInlineModel } from "../utils/toolBlock";
import {
  buildTranscriptDisplayItems,
  contentBlocks,
  errorMessageText,
  isAbortedMessage,
  isErrorMessage,
  isToolResultMessage,
  messageContent,
  type ImageContentBlock,
  type PendingTranscriptSessionEvent,
  type ToolContentBlock,
  type TranscriptDisplayItem,
  type TranscriptSessionEventDisplayItem,
} from "../utils/transcript";
import DiffView from "./DiffView.vue";
import HighlightedCode from "./HighlightedCode.vue";
import ImageLightbox from "./ImageLightbox.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";

const props = defineProps<{
  sessionPath: string | null;
  messages: readonly TranscriptEntry[];
  hasOlder: boolean;
  initialLoading: boolean;
  pageLoading: boolean;
  pendingTranscriptConfigEvent: PendingTranscriptSessionEvent | null;
  isStreaming: boolean;
  isCompacting: boolean;
  showMessageIds: boolean;
  allowRevision: boolean;
}>();

const emit = defineEmits<{
  loadOlder: [];
  revise: [
    payload: {
      entryId: string;
      text: string;
      preview: string;
      hasImages: boolean;
      images: RpcImageContent[];
    },
  ];
  openFileReference: [payload: { path: string; lineNumber: number }];
}>();

const container = ref<HTMLDivElement | null>(null);
const userCopySelector = "[data-user-message-index]";

type SessionScrollSnapshot = {
  anchorEntryId: string | null;
  anchorOffset: number;
  scrollTop: number;
  stickToBottom: boolean;
};

type PendingSessionRestore = {
  sessionPath: string;
  snapshot: SessionScrollSnapshot;
  waitingForOlder: boolean;
};

let wasDisconnected = false;
let savedScrollTop = 0;
let savedScrollHeight = 0;
let topLoadArmed = true;
let shouldStickToBottom = true;
let pendingHistoryAnchor: { scrollTop: number; scrollHeight: number } | null =
  null;
let pendingSessionRestore: PendingSessionRestore | null = null;
const sessionScrollSnapshots = new Map<string, SessionScrollSnapshot>();
const TREE_ENTRY_SELECTOR = "[data-tree-entry-id], [data-tree-entry-ids]";

const TOP_LOAD_THRESHOLD = 120;
const AUTO_SCROLL_BOTTOM_THRESHOLD = 48;

function treeEntryIdForElement(element: HTMLElement): string | null {
  if (element.dataset.treeEntryId) {
    return element.dataset.treeEntryId;
  }

  return element.dataset.treeEntryIds?.split(/\s+/).find(Boolean) ?? null;
}

function findTreeEntryElement(messageId: string): HTMLElement | null {
  const root = container.value;
  if (!root || !messageId) return null;

  return (
    [...root.querySelectorAll<HTMLElement>(TREE_ENTRY_SELECTOR)].find(
      element => {
        if (element.dataset.treeEntryId === messageId) {
          return true;
        }

        return (
          element.dataset.treeEntryIds
            ?.split(/\s+/)
            .filter(Boolean)
            .includes(messageId) ?? false
        );
      },
    ) ?? null
  );
}

function isNearBottom(): boolean {
  const root = container.value;
  if (!root) return true;
  return (
    root.scrollHeight - root.clientHeight - root.scrollTop <=
    AUTO_SCROLL_BOTTOM_THRESHOLD
  );
}

function captureScrollSnapshot(): SessionScrollSnapshot | null {
  const root = container.value;
  if (!root) return null;

  const rootRect = root.getBoundingClientRect();
  const anchorElement = [
    ...root.querySelectorAll<HTMLElement>(TREE_ENTRY_SELECTOR),
  ].find(element => element.getBoundingClientRect().bottom > rootRect.top);

  return {
    anchorEntryId: anchorElement ? treeEntryIdForElement(anchorElement) : null,
    anchorOffset: anchorElement
      ? anchorElement.getBoundingClientRect().top - rootRect.top
      : 0,
    scrollTop: root.scrollTop,
    stickToBottom: isNearBottom(),
  };
}

function rememberSessionScroll(sessionPath: string | null = props.sessionPath) {
  if (!sessionPath) return;
  const snapshot = captureScrollSnapshot();
  if (!snapshot) return;
  sessionScrollSnapshots.set(sessionPath, snapshot);
}

function preserveScroll() {
  if (!container.value) return;
  rememberSessionScroll();
  savedScrollTop = container.value.scrollTop;
  savedScrollHeight = container.value.scrollHeight;
  wasDisconnected = true;
}

function restoreScroll() {
  if (!container.value || !wasDisconnected) return;
  const delta = container.value.scrollHeight - savedScrollHeight;
  container.value.scrollTop = savedScrollTop + delta;
  shouldStickToBottom = isNearBottom();
  wasDisconnected = false;
}

function scrollToBottom() {
  if (!container.value) return;
  container.value.scrollTop = container.value.scrollHeight;
  shouldStickToBottom = true;
}

function restoreSnapshotByAnchor(snapshot: SessionScrollSnapshot): boolean {
  const root = container.value;
  if (!root || !snapshot.anchorEntryId) return false;

  const target = findTreeEntryElement(snapshot.anchorEntryId);
  if (!target) return false;

  const rootRect = root.getBoundingClientRect();
  const targetTop = target.getBoundingClientRect().top - rootRect.top;
  root.scrollTop += targetTop - snapshot.anchorOffset;
  shouldStickToBottom = isNearBottom();
  return true;
}

function restoreSnapshotByScrollTop(snapshot: SessionScrollSnapshot) {
  if (!container.value) return;
  const maxScrollTop = Math.max(
    0,
    container.value.scrollHeight - container.value.clientHeight,
  );
  container.value.scrollTop = Math.min(maxScrollTop, snapshot.scrollTop);
  shouldStickToBottom = isNearBottom();
}

function tryRestorePendingSessionScroll(): boolean {
  const pending = pendingSessionRestore;
  if (!pending || props.sessionPath !== pending.sessionPath) return false;

  if (pending.snapshot.stickToBottom) {
    scrollToBottom();
    pendingSessionRestore = null;
    return true;
  }

  if (props.pageLoading || props.initialLoading) {
    return true;
  }

  pending.waitingForOlder = false;
  if (restoreSnapshotByAnchor(pending.snapshot)) {
    pendingSessionRestore = null;
    return true;
  }

  if (
    pending.snapshot.anchorEntryId &&
    props.hasOlder &&
    !pending.waitingForOlder
  ) {
    pending.waitingForOlder = true;
    emit("loadOlder");
    return true;
  }

  restoreSnapshotByScrollTop(pending.snapshot);
  pendingSessionRestore = null;
  return true;
}

async function syncViewportAfterRender() {
  await nextTick();

  if (pendingHistoryAnchor && container.value) {
    const delta =
      container.value.scrollHeight - pendingHistoryAnchor.scrollHeight;
    container.value.scrollTop = pendingHistoryAnchor.scrollTop + delta;
    shouldStickToBottom = isNearBottom();
    pendingHistoryAnchor = null;
    return;
  }

  if (tryRestorePendingSessionScroll()) {
    return;
  }

  if (wasDisconnected) {
    restoreScroll();
    return;
  }

  if (shouldStickToBottom) {
    scrollToBottom();
  }
}

function scrollToMessageId(messageId: string): boolean {
  const target = findTreeEntryElement(messageId);
  if (!target) return false;

  target.scrollIntoView({ block: "center", behavior: "smooth" });
  return true;
}

function roleClass(role: string): "user" | "assistant" | "tool" | "system" {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "system") return "system";
  return "tool";
}

const expandedToolBlocks = ref(new Set<string>());
const expandedThinking = ref(new Set<string>());
const displayItems = computed(() =>
  buildTranscriptDisplayItems(props.messages, {
    pendingSessionEvent: props.pendingTranscriptConfigEvent,
  }),
);
const showBusyIndicator = computed(
  () => props.isStreaming || props.isCompacting,
);
const streamingAssistantMessageIndex = computed(() => {
  if (!props.isStreaming) return -1;

  for (let index = props.messages.length - 1; index >= 0; index--) {
    if (props.messages[index]?.role === "assistant") return index;
  }

  return -1;
});
const busyIndicatorLabel = computed(() =>
  props.isCompacting && !props.isStreaming
    ? "Compacting context"
    : "Responding",
);
const lightboxImages = ref<ImageContentBlock[]>([]);
const lightboxIndex = ref(0);
const toolBlockModelCache = new WeakMap<
  ToolContentBlock,
  ReturnType<typeof buildToolInlineModel>
>();
const toolBlockDetailCache = new WeakMap<
  ToolContentBlock,
  ReturnType<typeof buildToolDetailModel>
>();

function messageStableKey(msg: TranscriptEntry, index: number): string {
  return msg.transcriptKey ?? msg.id ?? `message:${index}`;
}

function displayItemKey(item: TranscriptDisplayItem, index: number): string {
  return item.kind === "message"
    ? messageStableKey(item.message, item.messageIndex)
    : item.key || `session-event:${index}`;
}

function sessionEventModelText(
  item: TranscriptSessionEventDisplayItem,
): string {
  if (!item.model) return "";
  return item.model.provider
    ? `${item.model.provider} / ${item.model.id}`
    : item.model.id;
}

function toolBlockKey(messageKey: string, blockIdx: number): string {
  return `${messageKey}-${blockIdx}`;
}

function shouldDeferMessageMarkdownErrors(
  msg: TranscriptEntry,
  messageIndex: number,
): boolean {
  return (
    msg.role === "assistant" &&
    messageIndex === streamingAssistantMessageIndex.value
  );
}

function toggleToolBlock(messageKey: string, blockIdx: number) {
  const key = toolBlockKey(messageKey, blockIdx);
  const next = new Set(expandedToolBlocks.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedToolBlocks.value = next;
}

function toggleThinking(messageKey: string, blockIdx: number) {
  const key = toolBlockKey(messageKey, blockIdx);
  const next = new Set(expandedThinking.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedThinking.value = next;
}

function isToolBlockExpanded(messageKey: string, blockIdx: number): boolean {
  return expandedToolBlocks.value.has(toolBlockKey(messageKey, blockIdx));
}

function isThinkingExpanded(messageKey: string, blockIdx: number): boolean {
  return expandedThinking.value.has(toolBlockKey(messageKey, blockIdx));
}

function previewText(text: string, maxLines: number = 8): string {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return "";
  const lines = normalized.split("\n");
  if (lines.length <= maxLines) return normalized;
  const remaining = lines.length - maxLines;
  return `${lines.slice(0, maxLines).join("\n")}\n... ${remaining} more line${remaining === 1 ? "" : "s"}`;
}

function compactInlineText(
  text: string | undefined,
  maxLength: number = 96,
): string | undefined {
  if (!text) return undefined;
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (!singleLine) return undefined;
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3).trimEnd()}...`;
}

function toolBlockModel(block: ToolContentBlock) {
  const cached = toolBlockModelCache.get(block);
  if (cached) return cached;
  const model = buildToolInlineModel(block);
  toolBlockModelCache.set(block, model);
  return model;
}

function toolBlockDescriptor(block: ToolContentBlock): {
  name: string;
  params?: string;
  meta?: string;
  status: ToolContentBlock["toolStatus"];
} {
  const model = toolBlockModel(block);
  return {
    name: block.toolName || "tool",
    params: model.title !== model.label ? model.title : undefined,
    meta: model.meta ?? toolStatusMeta(block.toolStatus),
    status: block.toolStatus,
  };
}

function toolBlockDiffStats(block: ToolContentBlock) {
  return toolBlockModel(block).diffStats;
}

function toolBlockDetail(block: ToolContentBlock) {
  const cached = toolBlockDetailCache.get(block);
  if (cached) return cached;
  const detail = buildToolDetailModel(block);
  toolBlockDetailCache.set(block, detail);
  return detail;
}

function toolStatusMeta(
  status: ToolContentBlock["toolStatus"] | "success" | "error",
): string | undefined {
  if (status === "pending") return "running";
  if (status === "error") return "error";
  return undefined;
}

function toolBlockImages(block: ToolContentBlock): ImageContentBlock[] {
  return (block.resultBlocks ?? []).filter(
    (item): item is ImageContentBlock => item.kind === "image",
  );
}

function toolBlockEmptyState(block: ToolContentBlock): string {
  if (block.toolStatus === "pending") return "Waiting for tool result.";
  if (block.toolName === "write" && toolBlockDetail(block).kind === "empty") {
    return "File is empty.";
  }
  return "No text result.";
}

function toolResultText(msg: TranscriptEntry): string {
  if (msg.toolName === "read" && toolResultImages(msg).length > 0) {
    return "";
  }

  return contentBlocks(msg)
    .flatMap(block => (block.kind === "text" ? [block.text] : []))
    .join("\n");
}

function toolResultPreview(msg: TranscriptEntry): string {
  return previewText(toolResultText(msg), 6);
}

function toolResultImages(msg: TranscriptEntry): ImageContentBlock[] {
  return contentBlocks(msg).filter(
    (block): block is ImageContentBlock => block.kind === "image",
  );
}

function toolResultName(msg: TranscriptEntry): string {
  return msg.toolName?.trim() || "tool";
}

function toolResultMeta(msg: TranscriptEntry): string | undefined {
  const preview = compactInlineText(toolResultPreview(msg));
  if (preview) return preview;
  const images = toolResultImages(msg);
  if (images.length > 0) {
    return `${images.length} image${images.length === 1 ? "" : "s"}`;
  }
  return toolStatusMeta(msg.isError ? "error" : "success");
}

function errorSummaryLabel(msg: TranscriptEntry): string {
  return isAbortedMessage(msg) ? "cancelled" : "error";
}

function errorSummaryMeta(msg: TranscriptEntry): string | undefined {
  return compactInlineText(errorMessageText(msg), 120);
}

function openImageLightbox(
  images: readonly ImageContentBlock[],
  index: number = 0,
) {
  if (images.length === 0) return;
  lightboxImages.value = [...images];
  lightboxIndex.value = Math.min(Math.max(index, 0), images.length - 1);
}

function closeImageLightbox() {
  lightboxImages.value = [];
  lightboxIndex.value = 0;
}

function showPreviousLightboxImage() {
  if (lightboxImages.value.length <= 1) return;
  lightboxIndex.value =
    (lightboxIndex.value + lightboxImages.value.length - 1) %
    lightboxImages.value.length;
}

function showNextLightboxImage() {
  if (lightboxImages.value.length <= 1) return;
  lightboxIndex.value = (lightboxIndex.value + 1) % lightboxImages.value.length;
}

function messageIdLabel(msg: TranscriptEntry): string {
  return msg.id ?? "missing";
}

function userMessageText(msg: TranscriptEntry): string {
  return messageContent(msg).trim();
}

function messageImages(msg: TranscriptEntry): RpcImageContent[] {
  if (!Array.isArray(msg.content)) return [];

  return msg.content.flatMap(item => {
    if (typeof item !== "object" || item === null) return [];

    const block = item as {
      type?: unknown;
      data?: unknown;
      mimeType?: unknown;
    };
    if (
      block.type !== "image" ||
      typeof block.data !== "string" ||
      typeof block.mimeType !== "string"
    ) {
      return [];
    }

    return [
      {
        type: "image" as const,
        data: block.data,
        mimeType: block.mimeType,
      },
    ];
  });
}

function revisionPreview(text: string, maxLength: number = 96): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}

function canReviseMessage(msg: TranscriptEntry): msg is TranscriptEntry & {
  id: string;
} {
  return Boolean(
    props.allowRevision &&
    !showBusyIndicator.value &&
    msg.role === "user" &&
    typeof msg.id === "string" &&
    userMessageText(msg),
  );
}

function handleRevise(msg: TranscriptEntry) {
  if (!canReviseMessage(msg)) return;
  const text = userMessageText(msg);
  const images = messageImages(msg);
  emit("revise", {
    entryId: msg.id,
    text,
    preview: revisionPreview(text),
    hasImages: images.length > 0,
    images,
  });
}

function userMessageElementForNode(node: Node | null): HTMLElement | null {
  const root = container.value;
  if (!root || !node) return null;

  const element = node instanceof Element ? node : node.parentElement;
  const candidate = element?.closest<HTMLElement>(userCopySelector) ?? null;
  if (!candidate || !root.contains(candidate)) return null;
  return candidate;
}

function selectedUserMessageElements(selection: Selection): HTMLElement[] {
  const root = container.value;
  if (!root || selection.rangeCount === 0 || selection.isCollapsed) return [];

  const elements = new Set<HTMLElement>();
  const userElements = root.querySelectorAll<HTMLElement>(userCopySelector);

  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index);
    if (!range.intersectsNode(root)) continue;

    for (const element of userElements) {
      if (range.intersectsNode(element)) elements.add(element);
    }

    const startElement = userMessageElementForNode(range.startContainer);
    const endElement = userMessageElementForNode(range.endContainer);
    if (startElement) elements.add(startElement);
    if (endElement) elements.add(endElement);
  }

  return [...elements];
}

function selectedUserCopyText(selection: Selection | null): string | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const [element, extraElement] = selectedUserMessageElements(selection);
  if (!element || extraElement) return null;

  const messageIndex = Number(element.dataset.userMessageIndex);
  const msg = Number.isInteger(messageIndex)
    ? props.messages[messageIndex]
    : undefined;
  if (!msg) return null;

  return userMessageCopyText(msg, selection.toString(), element.innerText);
}

function handleCopy(event: ClipboardEvent) {
  const text = selectedUserCopyText(window.getSelection());
  if (!text || !event.clipboardData) return;

  event.clipboardData.setData("text/plain", text);
  event.preventDefault();
}

function requestOlderTranscript() {
  if (!container.value) return;
  if (!props.hasOlder || props.initialLoading || props.pageLoading) return;
  pendingHistoryAnchor = {
    scrollTop: container.value.scrollTop,
    scrollHeight: container.value.scrollHeight,
  };
  emit("loadOlder");
}

function maybeLoadOlderTranscript() {
  if (!container.value) return;
  if (!props.hasOlder || props.initialLoading || props.pageLoading) return;

  if (container.value.scrollTop > TOP_LOAD_THRESHOLD) {
    topLoadArmed = true;
    return;
  }

  if (!topLoadArmed) return;
  topLoadArmed = false;
  requestOlderTranscript();
}

function handleScroll() {
  shouldStickToBottom = isNearBottom();
  maybeLoadOlderTranscript();
}

onMounted(() => {
  document.addEventListener("copy", handleCopy);
  container.value?.addEventListener("scroll", handleScroll, { passive: true });
  shouldStickToBottom = isNearBottom();
});
onBeforeUnmount(() => {
  document.removeEventListener("copy", handleCopy);
  container.value?.removeEventListener("scroll", handleScroll);
});

watch(
  () => props.sessionPath,
  (sessionPath, previousSessionPath) => {
    if (previousSessionPath && previousSessionPath !== sessionPath) {
      rememberSessionScroll(previousSessionPath);
    }

    pendingSessionRestore = sessionPath
      ? (() => {
          const snapshot = sessionScrollSnapshots.get(sessionPath);
          return snapshot
            ? {
                sessionPath,
                snapshot,
                waitingForOlder: false,
              }
            : null;
        })()
      : null;

    topLoadArmed = true;
  },
);

watch(
  () =>
    [
      props.sessionPath,
      props.messages,
      props.hasOlder,
      props.initialLoading,
      props.pageLoading,
      showBusyIndicator.value,
    ] as const,
  async () => {
    await syncViewportAfterRender();
  },
  { immediate: true },
);

watch(
  () => [props.hasOlder, props.initialLoading, props.pageLoading] as const,
  ([hasOlder, initialLoading, pageLoading]) => {
    if (!hasOlder || initialLoading || pageLoading) return;
    if (!container.value) return;
    if (container.value.scrollTop > TOP_LOAD_THRESHOLD) {
      topLoadArmed = true;
    }
  },
);

defineExpose({ preserveScroll, rememberSessionScroll, scrollToMessageId });
</script>

<template>
  <div ref="container" class="chat-transcript">
    <div v-if="initialLoading" class="empty-state loading-state">
      <p class="empty-title">Loading conversation</p>
      <p class="empty-subtitle">Fetching the latest transcript window.</p>
    </div>
    <div v-else-if="messages.length === 0" class="empty-state">
      <p class="empty-title">Start a conversation</p>
      <p class="empty-subtitle">Start typing to keep the session moving.</p>
      <div class="empty-hints">
        <span class="hint-chip">Enter send</span>
        <span class="hint-chip">Drop or paste images</span>
      </div>
    </div>
    <div v-if="!initialLoading && hasOlder" class="history-loader">
      <button
        type="button"
        class="history-loader-button"
        :disabled="pageLoading"
        @click="requestOlderTranscript()"
      >
        {{
          pageLoading ? "Loading earlier messages..." : "Load earlier messages"
        }}
      </button>
    </div>

    <template
      v-for="(item, index) in displayItems"
      :key="displayItemKey(item, index)"
    >
      <div
        v-if="item.kind === 'session_event'"
        class="session-event-row"
        :data-tree-entry-ids="item.sourceMessageIds.join(' ') || undefined"
      >
        <div class="session-event-line" aria-hidden="true"></div>
        <div class="session-event-body">
          <span class="session-event-label">{{ item.label }}</span>
          <span v-if="item.model" class="session-event-chip">
            <span class="session-event-chip-label">Model</span>
            <span class="session-event-chip-value">{{
              sessionEventModelText(item)
            }}</span>
          </span>
          <span v-if="item.thinkingLevel" class="session-event-chip">
            <span class="session-event-chip-label">Thinking</span>
            <span class="session-event-chip-value">{{
              item.thinkingLevel
            }}</span>
          </span>
          <span
            v-if="showMessageIds && item.sourceMessageIds.length > 0"
            class="session-event-debug"
          >
            IDs {{ item.sourceMessageIds.join(", ") }}
          </span>
        </div>
        <div class="session-event-line" aria-hidden="true"></div>
      </div>

      <template v-else>
        <div
          v-if="isToolResultMessage(item.message)"
          class="message-row tool"
          :data-message-id="item.message.id ?? undefined"
          :data-tree-entry-id="item.message.id ?? undefined"
        >
          <div class="message-content tool">
            <div
              class="tool-inline"
              :data-status="item.message.isError ? 'error' : 'success'"
            >
              <button
                type="button"
                class="tool-inline-toggle"
                @click="
                  toggleToolBlock(
                    messageStableKey(item.message, item.messageIndex),
                    -1,
                  )
                "
                :aria-expanded="
                  isToolBlockExpanded(
                    messageStableKey(item.message, item.messageIndex),
                    -1,
                  )
                "
              >
                <span class="tool-inline-summary">
                  <span class="tool-inline-name">{{
                    toolResultName(item.message)
                  }}</span>
                </span>
                <span
                  v-if="toolResultMeta(item.message)"
                  class="tool-inline-meta"
                >
                  {{ toolResultMeta(item.message) }}
                </span>
              </button>

              <div
                v-if="
                  isToolBlockExpanded(
                    messageStableKey(item.message, item.messageIndex),
                    -1,
                  )
                "
                class="tool-inline-details"
              >
                <span v-if="showMessageIds" class="message-debug-id">
                  ID {{ messageIdLabel(item.message) }}
                </span>
                <div
                  v-if="toolResultImages(item.message).length > 0"
                  class="tool-inline-images"
                >
                  <figure
                    v-for="(image, imageIndex) in toolResultImages(
                      item.message,
                    )"
                    :key="`${image.src}-${imageIndex}`"
                    class="message-image-block"
                  >
                    <button
                      type="button"
                      class="message-image-button"
                      :aria-label="`Open image ${imageIndex + 1}`"
                      @click="
                        openImageLightbox(
                          toolResultImages(item.message),
                          imageIndex,
                        )
                      "
                    >
                      <img
                        class="message-image"
                        :src="image.src"
                        :alt="image.alt"
                        loading="lazy"
                      />
                    </button>
                  </figure>
                </div>
                <section
                  v-if="toolResultText(item.message).trim()"
                  class="tool-inline-section"
                >
                  <div
                    v-if="toolResultName(item.message) === 'bash'"
                    class="tool-inline-code-panel"
                  >
                    <pre class="tool-inline-code-output">{{
                      toolResultText(item.message)
                    }}</pre>
                  </div>
                  <pre v-else class="tool-inline-pre">{{
                    toolResultText(item.message)
                  }}</pre>
                </section>
                <div
                  v-else-if="toolResultImages(item.message).length === 0"
                  class="tool-inline-empty"
                >
                  No text result.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-else-if="isErrorMessage(item.message)"
          class="message-row"
          :class="roleClass(item.message.role)"
          :data-message-id="item.message.id ?? undefined"
          :data-tree-entry-id="item.message.id ?? undefined"
        >
          <div class="message-content" :class="roleClass(item.message.role)">
            <div class="tool-inline" data-status="error">
              <button
                type="button"
                class="tool-inline-toggle"
                @click="
                  toggleToolBlock(
                    messageStableKey(item.message, item.messageIndex),
                    -2,
                  )
                "
                :aria-expanded="
                  isToolBlockExpanded(
                    messageStableKey(item.message, item.messageIndex),
                    -2,
                  )
                "
              >
                <span class="tool-inline-summary">
                  <span class="tool-inline-name">
                    {{ errorSummaryLabel(item.message) }}
                  </span>
                </span>
                <span
                  v-if="errorSummaryMeta(item.message)"
                  class="tool-inline-meta"
                >
                  {{ errorSummaryMeta(item.message) }}
                </span>
              </button>

              <div
                v-if="
                  isToolBlockExpanded(
                    messageStableKey(item.message, item.messageIndex),
                    -2,
                  )
                "
                class="tool-inline-details"
              >
                <span v-if="showMessageIds" class="message-debug-id">
                  ID {{ messageIdLabel(item.message) }}
                </span>
                <section
                  v-if="errorMessageText(item.message)"
                  class="tool-inline-section"
                >
                  <pre class="tool-inline-pre">{{
                    errorMessageText(item.message)
                  }}</pre>
                </section>
                <div v-else class="tool-inline-empty">No error message.</div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-else
          class="message-row"
          :class="roleClass(item.message.role)"
          :data-message-id="item.message.id ?? undefined"
          :data-tree-entry-id="item.message.id ?? undefined"
        >
          <div class="message-stack" :class="roleClass(item.message.role)">
            <div
              class="message-content"
              :class="roleClass(item.message.role)"
              :data-user-message-index="
                item.message.role === 'user' ? item.messageIndex : undefined
              "
            >
              <div v-if="showMessageIds" class="message-debug-id">
                ID {{ messageIdLabel(item.message) }}
              </div>
              <template
                v-for="(block, bIdx) in contentBlocks(item.message)"
                :key="bIdx"
              >
                <article
                  v-if="block.kind === 'system'"
                  class="system-block"
                  :data-system-type="block.systemType"
                >
                  <div class="system-block-header">
                    <span class="system-block-label">{{ block.label }}</span>
                    <span v-if="block.meta" class="system-block-meta">{{
                      block.meta
                    }}</span>
                  </div>
                  <div class="system-block-title">{{ block.title }}</div>
                  <MarkdownRenderer
                    v-if="block.body"
                    class="system-block-body"
                    :content="block.body"
                    @open-file-reference="emit('openFileReference', $event)"
                  />
                </article>

                <div
                  v-else-if="block.kind === 'thinking'"
                  class="thinking-block"
                >
                  <button
                    class="thinking-toggle"
                    @click="
                      toggleThinking(
                        messageStableKey(item.message, item.messageIndex),
                        bIdx,
                      )
                    "
                  >
                    <Sparkle class="toggle-icon" aria-hidden="true" />
                    Thinking
                  </button>
                  <MarkdownRenderer
                    v-if="
                      isThinkingExpanded(
                        messageStableKey(item.message, item.messageIndex),
                        bIdx,
                      )
                    "
                    class="thinking-content"
                    :content="block.text"
                    :defer-mermaid-errors="
                      shouldDeferMessageMarkdownErrors(
                        item.message,
                        item.messageIndex,
                      )
                    "
                    @open-file-reference="emit('openFileReference', $event)"
                  />
                </div>

                <div
                  v-else-if="block.kind === 'tool'"
                  class="tool-inline-block"
                  :data-tree-entry-id="block.resultSourceMessageId"
                >
                  <div
                    class="tool-inline"
                    :data-status="toolBlockDescriptor(block).status"
                  >
                    <button
                      type="button"
                      class="tool-inline-toggle"
                      @click="
                        toggleToolBlock(
                          messageStableKey(item.message, item.messageIndex),
                          bIdx,
                        )
                      "
                      :aria-expanded="
                        isToolBlockExpanded(
                          messageStableKey(item.message, item.messageIndex),
                          bIdx,
                        )
                      "
                    >
                      <span class="tool-inline-summary">
                        <span class="tool-inline-name">{{
                          toolBlockDescriptor(block).name
                        }}</span>
                        <span
                          v-if="toolBlockDescriptor(block).params"
                          class="tool-inline-params"
                        >
                          {{ toolBlockDescriptor(block).params }}
                        </span>
                      </span>
                      <span
                        v-if="toolBlockDiffStats(block)"
                        class="tool-inline-diff"
                        :aria-label="`${toolBlockDiffStats(block)?.added ?? 0} additions, ${toolBlockDiffStats(block)?.removed ?? 0} deletions`"
                      >
                        <span class="tool-inline-diff-added"
                          >+{{ toolBlockDiffStats(block)?.added }}</span
                        >
                        <span class="tool-inline-diff-removed"
                          >-{{ toolBlockDiffStats(block)?.removed }}</span
                        >
                      </span>
                      <span
                        v-else-if="toolBlockDescriptor(block).meta"
                        class="tool-inline-meta"
                      >
                        {{ toolBlockDescriptor(block).meta }}
                      </span>
                    </button>

                    <div
                      v-if="
                        isToolBlockExpanded(
                          messageStableKey(item.message, item.messageIndex),
                          bIdx,
                        )
                      "
                      class="tool-inline-details"
                    >
                      <span
                        v-if="showMessageIds && block.resultSourceMessageId"
                        class="message-debug-id"
                      >
                        ID {{ block.resultSourceMessageId }}
                      </span>
                      <div
                        v-if="toolBlockImages(block).length > 0"
                        class="tool-inline-images"
                      >
                        <figure
                          v-for="(image, imageIndex) in toolBlockImages(block)"
                          :key="`${image.src}-${imageIndex}`"
                          class="message-image-block"
                        >
                          <button
                            type="button"
                            class="message-image-button"
                            :aria-label="`Open image ${imageIndex + 1}`"
                            @click="
                              openImageLightbox(
                                toolBlockImages(block),
                                imageIndex,
                              )
                            "
                          >
                            <img
                              class="message-image"
                              :src="image.src"
                              :alt="image.alt"
                              loading="lazy"
                            />
                          </button>
                        </figure>
                      </div>
                      <section
                        v-if="toolBlockDetail(block).kind !== 'empty'"
                        class="tool-inline-section"
                      >
                        <DiffView
                          v-if="toolBlockDetail(block).kind === 'diff'"
                          :diff="toolBlockDetail(block).text || ''"
                        />
                        <div
                          v-else-if="toolBlockDetail(block).kind === 'code'"
                          class="tool-inline-code-panel"
                        >
                          <HighlightedCode
                            :code="toolBlockDetail(block).text || ''"
                            :path="toolBlockDetail(block).path"
                          />
                        </div>
                        <div
                          v-else-if="toolBlockDetail(block).kind === 'bash'"
                          class="tool-inline-code-panel"
                        >
                          <pre class="tool-inline-code-output">{{
                            toolBlockDetail(block).text
                          }}</pre>
                        </div>
                        <pre v-else class="tool-inline-pre">{{
                          toolBlockDetail(block).text
                        }}</pre>
                      </section>
                      <div
                        v-else-if="toolBlockImages(block).length === 0"
                        class="tool-inline-empty"
                      >
                        {{ toolBlockEmptyState(block) }}
                      </div>
                    </div>
                  </div>
                </div>

                <figure
                  v-else-if="block.kind === 'image'"
                  class="message-image-block"
                >
                  <button
                    type="button"
                    class="message-image-button"
                    aria-label="Open image"
                    @click="openImageLightbox([block])"
                  >
                    <img
                      class="message-image"
                      :src="block.src"
                      :alt="block.alt"
                      loading="lazy"
                    />
                  </button>
                </figure>

                <MarkdownRenderer
                  v-else-if="block.kind === 'text' && block.text"
                  :content="block.text"
                  :defer-mermaid-errors="
                    shouldDeferMessageMarkdownErrors(
                      item.message,
                      item.messageIndex,
                    )
                  "
                  @open-file-reference="emit('openFileReference', $event)"
                />
              </template>
            </div>
            <div v-if="canReviseMessage(item.message)" class="message-actions">
              <button
                type="button"
                class="message-action-button"
                aria-label="Edit message"
                title="Edit message"
                @click="handleRevise(item.message)"
              >
                <Pencil class="message-action-icon" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </template>
    </template>

    <div v-if="showBusyIndicator" class="streaming-indicator">
      <span class="busy-label">{{ busyIndicatorLabel }}</span>
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>

    <ImageLightbox
      :open="lightboxImages.length > 0"
      :images="lightboxImages"
      :index="lightboxIndex"
      @close="closeImageLightbox"
      @previous="showPreviousLightboxImage"
      @next="showNextLightboxImage"
    />
  </div>
</template>

<style scoped>
.chat-transcript {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 32px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: transparent;
  scrollbar-width: none;
}

.chat-transcript::-webkit-scrollbar {
  display: none;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  text-align: center;
  color: var(--text-muted);
}

.loading-state {
  min-height: 240px;
}

.empty-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 500;
  color: var(--text);
}

.empty-subtitle {
  margin: 0;
  max-width: 420px;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--text-subtle);
}

.empty-hints {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.hint-chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  font-size: 0.68rem;
  color: var(--text-subtle);
}

.history-loader {
  display: flex;
  justify-content: center;
  width: 100%;
}

.history-loader-button {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel);
  color: var(--text-subtle);
  padding: 8px 14px;
  font-size: 0.74rem;
  cursor: pointer;
}

.history-loader-button:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--text);
}

.history-loader-button:disabled {
  opacity: 0.7;
  cursor: progress;
}

.session-event-row {
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(24px, 1fr) auto minmax(24px, 1fr);
  align-items: center;
  gap: 12px;
}

.session-event-line {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--border) 88%, transparent),
    transparent
  );
}

.session-event-body {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}

.session-event-label {
  font-size: 0.66rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.session-event-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--panel) 76%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 20%, transparent);
  font-size: 0.72rem;
  line-height: 1.2;
  color: var(--text-muted);
}

.session-event-chip-label {
  display: inline-flex;
  align-items: center;
  padding-right: 8px;
  border-right: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  line-height: 1;
  color: var(--text-subtle);
}

.session-event-chip-value {
  display: inline-flex;
  align-items: center;
  font-weight: 500;
  line-height: 1.1;
  color: var(--text);
}

.session-event-debug {
  font-family: var(--pi-font-mono);
  font-size: 0.64rem;
  color: var(--text-subtle);
}

.message-row {
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
}

.message-row.assistant,
.message-row.user,
.message-row.system {
  display: flex;
}

.message-row.user {
  justify-content: flex-end;
}

.message-row.system {
  justify-content: center;
}

.message-row.tool {
  display: flex;
}

.message-stack {
  min-width: 0;
  width: 100%;
}

.message-stack.user {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.message-content {
  min-width: 0;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--text);
  word-break: break-word;
}

.message-content.assistant,
.message-content.tool,
.message-content.system {
  width: 100%;
  padding-left: 10px;
}

.message-debug-id {
  display: inline-flex;
  align-items: center;
  margin: 0 0 10px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  font-family: var(--pi-font-mono);
  font-size: 0.66rem;
  line-height: 1;
  color: var(--text-subtle);
}

.message-actions {
  display: flex;
  justify-content: flex-end;
  width: fit-content;
  max-width: min(720px, 100%);
  margin: 6px 4px 0 0;
}

.message-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
  background: color-mix(in srgb, var(--panel) 84%, transparent);
  color: var(--text-subtle);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  transition:
    opacity 0.14s ease,
    border-color 0.14s ease,
    color 0.14s ease,
    background 0.14s ease,
    transform 0.14s ease;
}

.message-stack.user:hover .message-action-button,
.message-stack.user:focus-within .message-action-button,
.message-action-button:focus-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.message-action-button:hover,
.message-action-button:focus-visible {
  border-color: var(--border-strong);
  background: var(--surface-hover);
  color: var(--text);
}

.message-action-button:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.message-action-icon {
  width: 14px;
  height: 14px;
}

.message-content.user {
  width: fit-content;
  max-width: min(720px, 100%);
  margin-left: auto;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 18px 18px 8px 18px;
  background: var(--panel-2);
}

.markdown-body + .markdown-body,
.markdown-body + .thinking-block,
.markdown-body + .tool-inline-block,
.markdown-body + .message-image-block,
.markdown-body + .system-block,
.thinking-block + .markdown-body,
.thinking-block + .tool-inline-block,
.thinking-block + .message-image-block,
.thinking-block + .system-block,
.tool-inline-block + .markdown-body,
.tool-inline-block + .thinking-block,
.tool-inline-block + .message-image-block,
.tool-inline-block + .system-block,
.message-image-block + .markdown-body,
.message-image-block + .thinking-block,
.message-image-block + .tool-inline-block,
.message-image-block + .message-image-block,
.message-image-block + .system-block,
.system-block + .markdown-body,
.system-block + .thinking-block,
.system-block + .tool-inline-block,
.system-block + .message-image-block,
.system-block + .system-block {
  margin-top: 4px;
}

.tool-inline-block + .tool-inline-block {
  margin-top: 6px;
}

.thinking-block {
  padding-left: 0;
}

.system-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(720px, 100%);
  margin: 0 auto;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--panel) 86%, transparent);
}

.system-block-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.system-block-label,
.system-block-meta {
  font-size: 0.66rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.system-block-title {
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--text);
}

.system-block-body {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.76rem;
  line-height: 1.6;
}

.message-image-block {
  margin: 0;
}

.message-image-button {
  display: block;
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-in;
}

.message-image {
  display: block;
  max-width: min(100%, 420px);
  max-height: 320px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  box-shadow: var(--shadow-raised);
  object-fit: contain;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    border-color 0.16s ease;
}

.message-image-button:hover .message-image,
.message-image-button:focus-visible .message-image {
  transform: translateY(-1px) scale(1.01);
  border-color: var(--accent);
  box-shadow:
    0 0 0 3px var(--focus-ring),
    var(--shadow-floating);
}

.thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.7rem;
  line-height: 1.3;
  cursor: pointer;
}

.thinking-toggle:hover {
  color: var(--text);
}

.thinking-content {
  margin: 0;
  padding: 0;
  font-size: 0.74rem;
  line-height: 1.55;
  color: var(--text-muted);
  max-height: 400px;
  overflow-y: auto;
  word-break: break-word;
}

.tool-inline {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-inline-toggle {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  column-gap: 8px;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.tool-inline-toggle:hover .tool-inline-name,
.tool-inline-toggle:hover .tool-inline-params,
.tool-inline-toggle:hover .tool-inline-meta {
  color: var(--text);
}

.tool-inline-toggle:focus-visible {
  outline: none;
}

.tool-inline-toggle:focus-visible .tool-inline-name,
.tool-inline-toggle:focus-visible .tool-inline-params,
.tool-inline-toggle:focus-visible .tool-inline-meta {
  text-decoration: underline;
  text-decoration-color: var(--accent);
  text-decoration-thickness: 1px;
}

.tool-inline-summary {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.tool-inline-name {
  flex: none;
  font-family: var(--pi-font-mono);
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-muted);
}

.tool-inline-params {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.72rem;
  line-height: 1.3;
  color: var(--text-subtle);
}

.tool-inline-meta,
.tool-inline-diff {
  flex: none;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.66rem;
  line-height: 1.3;
}

.tool-inline-meta {
  color: var(--text-subtle);
}

.tool-inline-diff {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--pi-font-mono);
  font-weight: 600;
}

.tool-inline-diff-added {
  color: var(--diff-added-accent);
}

.tool-inline-diff-removed {
  color: var(--diff-removed-accent);
}

.tool-inline[data-status="error"] .tool-inline-name,
.tool-inline[data-status="error"] .tool-inline-meta {
  color: var(--error-text);
}

.tool-inline-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 1px;
}

.tool-inline-section {
  display: flex;
  flex-direction: column;
}

.tool-inline-code-panel,
.tool-inline-pre {
  margin: 0;
  border: 1px solid var(--tool-output-border);
  border-radius: 10px;
  background: var(--tool-output-bg);
  overflow: auto;
}

.tool-inline-code-panel {
  max-height: 360px;
}

.tool-inline-code-panel :deep(.highlighted-code pre),
.tool-inline-code-panel :deep(.highlighted-code-fallback) {
  margin: 0;
  padding: 10px 12px;
  background: transparent !important;
}

.tool-inline-code-output,
.tool-inline-pre {
  padding: 10px 12px;
  font-family: var(--pi-font-mono);
  font-size: 0.72rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-muted);
}

.tool-inline-code-output {
  margin: 0;
}

.tool-inline[data-status="error"] .tool-inline-code-panel,
.tool-inline[data-status="error"] .tool-inline-pre {
  border-color: color-mix(
    in srgb,
    var(--error-border) 88%,
    var(--tool-output-border)
  );
  background: color-mix(in srgb, var(--tool-output-bg) 86%, transparent);
  color: var(--error-text);
}

.tool-inline[data-status="error"] .tool-inline-code-output {
  color: var(--error-text);
}

.tool-inline-images {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tool-inline-empty {
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--text-subtle);
}

.toggle-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 0 0 8px 14px;
  box-sizing: border-box;
}

.busy-label {
  margin-right: 4px;
  font-size: 0.72rem;
  color: var(--text-subtle);
}

.streaming-indicator .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: blink 1.2s infinite;
}

.streaming-indicator .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.streaming-indicator .dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes blink {
  0%,
  80%,
  100% {
    opacity: 0.2;
  }
  40% {
    opacity: 1;
  }
}

@media (max-width: 900px) {
  .chat-transcript {
    padding: 16px 16px 10px;
  }

  .session-event-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .session-event-line {
    display: none;
  }

  .message-content.assistant,
  .message-content.tool,
  .message-content.system {
    margin-left: 0;
    max-width: 100%;
    padding-left: 0;
  }

  .message-content.user {
    max-width: min(88%, 32rem);
    margin-left: auto;
  }

  .message-actions {
    max-width: 100%;
    margin-right: 0;
  }

  .thinking-block {
    padding-left: 0;
  }

  .system-block {
    max-width: 100%;
    padding: 10px 12px;
  }

  .tool-inline-toggle {
    grid-template-columns: minmax(0, 1fr);
    align-items: flex-start;
    row-gap: 2px;
  }

  .tool-inline-meta,
  .tool-inline-diff {
    grid-column: 1;
    max-width: 100%;
  }

  .streaming-indicator {
    width: 100%;
    padding-left: 0;
  }
}

@media (max-width: 640px) {
  .chat-transcript {
    padding: 12px 12px 8px;
    gap: 12px;
  }

  .message-content {
    font-size: 0.86rem;
    line-height: 1.65;
  }

  .message-content.user {
    max-width: min(90%, 100%);
    padding: 10px 12px;
    border-radius: 16px 16px 6px 16px;
  }

  .tool-inline-details {
    padding-top: 2px;
  }

  .error-block {
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
  }

  .error-message {
    padding: 9px 10px;
  }

  .error-message,
  .tool-inline-name,
  .tool-inline-params,
  .tool-inline-meta,
  .tool-inline-diff,
  .tool-inline-code-output,
  .tool-inline-pre,
  .tool-inline-empty,
  .thinking-content,
  .system-block-body {
    font-size: 0.68rem;
  }

  .message-image {
    max-width: 100%;
    max-height: 240px;
  }

  .streaming-indicator {
    width: 100%;
  }
}
</style>
