import type {
  RpcImageContent,
  RpcSlashCommand,
  RpcThinkingLevel,
  RpcWorkspaceEntry,
} from "@pi-web/bridge/types";
import type { ConnectionStatus } from "../composables/bridgeStore.svelte";
import type { ComposerAttachment } from "../utils/attachments";
import {
  createAttachmentSlice,
  attachmentsFromRpcImages,
} from "../utils/composerBarAttachments";
import { createContextSlice, MAX_TEXTAREA_HEIGHT, TEXTAREA_HEIGHT_BUFFER } from "../utils/composerBarContext";
import type { RpcModelInfo } from "../utils/models";
import { parseCompactSlashCommand } from "../utils/slashCommands";
import { getNextThinkingLevel } from "../utils/thinkingLevels";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComposerBarProps {
  readonly connectionStatus: ConnectionStatus;
  readonly isStreaming: boolean;
  readonly isDebugMode: boolean;
  readonly commands: readonly RpcSlashCommand[];
  readonly workspaceEntries: readonly RpcWorkspaceEntry[];
  readonly workspaceEntriesLoading: boolean;
  readonly workspaceContextKey: string | null;
  readonly ensureWorkspaceEntries: (
    force?: boolean,
  ) => Promise<RpcWorkspaceEntry[]>;
  readonly models: readonly RpcModelInfo[];
  readonly selectedModel: RpcModelInfo | null;
  readonly thinkingLevel: RpcThinkingLevel | null;
  readonly autoCompactionEnabled: boolean;
  readonly prefillText: string | null;
  readonly revision: RevisionPayload | null;
  readonly pendingMessageCount: number;
  readonly editQueuedPayload: EditQueuedPayload | null;
}

export interface ComposerBarCallbacks {
  readonly onSubmit: (payload: {
    message: string;
    images: RpcImageContent[];
    revisionEntryId?: string;
    steer?: boolean;
  }) => void;
  readonly onAbort: () => void;
  readonly onCancelRevision: () => void;
  readonly onSelectModel: (model: RpcModelInfo) => void;
  readonly onSelectThinkingLevel: (level: RpcThinkingLevel) => void;
  readonly onToggleAutoCompaction: (enabled: boolean) => void;
}

/** Externally-owned reactive variables that the state module reads/writes. */
export interface ComposerBarReactive {
  inputText: string;
  cursorOffset: number;
}

export interface RevisionPayload {
  entryId: string;
  text: string;
  preview: string;
  hasImages: boolean;
  images: RpcImageContent[];
}

export interface EditQueuedPayload {
  text: string;
  images: RpcImageContent[];
}

// ---------------------------------------------------------------------------
// Constants — re-exported from composerBarContext for shared resize logic
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function normalizeSubmittedText(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "")
    lines.pop();
  if (lines.length === 0) return "";
  lines[0] = lines[0]!.trimStart();
  lines[lines.length - 1] = lines[lines.length - 1]!.trimEnd();
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function createComposerBarState(
  props: ComposerBarProps,
  callbacks: ComposerBarCallbacks,
  $rx: ComposerBarReactive,
) {
  // ---- shared mutable state ----

  let isComposing = $state(false);
  let revisionBackup = $state<{
    text: string;
    attachments: ComposerAttachment[];
  } | null>(null);

  // ---- attach slices ----

  const attachmentSlice = createAttachmentSlice($rx);

  const contextSlice = createContextSlice(
    $rx,
    {
      isDebugMode: props.isDebugMode,
      commands: props.commands,
      workspaceEntries: props.workspaceEntries,
      workspaceEntriesLoading: props.workspaceEntriesLoading,
      workspaceContextKey: props.workspaceContextKey,
      ensureWorkspaceEntries: props.ensureWorkspaceEntries,
    },
    () => isDisabled,
  );

  // ---- derived state ----

  let isDisabled = $derived(props.connectionStatus !== "connected");

  let currentModelText = $derived.by(() => {
    if (!props.selectedModel)
      return props.models.length > 0 ? "choose model" : "no models";
    return props.selectedModel.name ?? props.selectedModel.id;
  });

  let normalizedInputText = $derived(normalizeSubmittedText($rx.inputText));
  let canSubmit = $derived(
    !isDisabled && (normalizedInputText.length > 0 || attachmentSlice.hasAttachments),
  );
  let canAbort = $derived(!isDisabled && props.isStreaming);
  let showStopButton = $derived(props.isStreaming && !canSubmit);
  let hasPendingMessages = $derived(props.pendingMessageCount > 0);

  // ---- textarea DOM helpers ----

  function syncCursorFromTextarea(
    textareaEl: HTMLTextAreaElement | null | undefined,
  ) {
    $rx.cursorOffset = textareaEl?.selectionStart ?? $rx.inputText.length;
  }

  function resizeTextarea(textareaEl: HTMLTextAreaElement | null | undefined) {
    queueMicrotask(() => {
      const el = textareaEl;
      if (!el) return;
      el.style.height = "auto";
      const styles = window.getComputedStyle(el);
      const lineHeight = Number.parseFloat(styles.lineHeight) || 0;
      const pt = Number.parseFloat(styles.paddingTop) || 0;
      const pb = Number.parseFloat(styles.paddingBottom) || 0;
      const minHeight = Math.ceil(
        lineHeight + pt + pb + TEXTAREA_HEIGHT_BUFFER,
      );
      const nextHeight = Math.min(
        Math.max(el.scrollHeight + TEXTAREA_HEIGHT_BUFFER, minHeight),
        MAX_TEXTAREA_HEIGHT,
      );
      el.style.height = `${nextHeight}px`;
      el.style.overflowY =
        el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
    });
  }

  function shouldRevealComposer(
    rootEl: HTMLDivElement | null | undefined,
  ): boolean {
    if (typeof window === "undefined") return false;
    const el = rootEl;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || 0;
    const margin = 24;
    return rect.top < margin || rect.bottom > vh - margin;
  }

  function focusComposer(opts?: {
    textareaEl?: HTMLTextAreaElement | null;
    rootEl?: HTMLDivElement | null;
    reveal?: boolean;
  }) {
    queueMicrotask(() => {
      if (opts?.reveal && shouldRevealComposer(opts.rootEl)) {
        opts.rootEl?.scrollIntoView({ behavior: "smooth", block: "end" });
      }
      const el = opts?.textareaEl;
      if (!el) return;
      el.focus();
      const cursor = $rx.inputText.length;
      el.setSelectionRange(cursor, cursor);
      $rx.cursorOffset = cursor;
      resizeTextarea(el);
    });
  }

  function applyExternalText(
    text: string,
    opts?: {
      clearAttachments?: boolean;
      fileInputEl?: HTMLInputElement | null;
      textareaEl?: HTMLTextAreaElement | null;
      rootEl?: HTMLDivElement | null;
    },
  ) {
    $rx.inputText = text;
    if (opts?.clearAttachments) attachmentSlice.clearAttachments(opts.fileInputEl);
    attachmentSlice.clearAttachmentNotice();
    contextSlice.resetDismissedPalettes();
    focusComposer({
      textareaEl: opts?.textareaEl,
      rootEl: opts?.rootEl,
      reveal: true,
    });
  }

  // ---- submission ----

  function resetComposerState(fileInputEl?: HTMLInputElement | null) {
    $rx.inputText = "";
    $rx.cursorOffset = 0;
    contextSlice.resetDismissedPalettes();
    revisionBackup = null;
    attachmentSlice.clearAttachments(fileInputEl);
    attachmentSlice.clearAttachmentNotice();
  }

  function submitMessage(
    message: string,
    steer: boolean,
    fileInputEl?: HTMLInputElement | null,
    textareaEl?: HTMLTextAreaElement | null,
  ) {
    callbacks.onSubmit({
      message,
      images: attachmentSlice.toRpcImages(),
      revisionEntryId: props.revision?.entryId,
      steer,
    });
    resetComposerState(fileInputEl);
    resizeTextarea(textareaEl);
  }

  function handleSubmit(
    steer: boolean,
    fileInputEl?: HTMLInputElement | null,
    textareaEl?: HTMLTextAreaElement | null,
  ): boolean {
    const text = normalizedInputText;
    if ((!text && !attachmentSlice.hasAttachments) || isDisabled) return false;
    if (parseCompactSlashCommand(text) && attachmentSlice.hasAttachments) {
      attachmentSlice.setAttachmentNotice(
        "/compact does not accept image attachments",
      );
      return false;
    }
    submitMessage(text, steer, fileInputEl, textareaEl);
    return true;
  }

  function handleAbortAction(): boolean {
    if (!canAbort) return false;
    callbacks.onAbort();
    return true;
  }

  // ---- thinking / compaction toggles ----

  function handleCycleThinkingLevel() {
    if (isDisabled) return;
    callbacks.onSelectThinkingLevel(getNextThinkingLevel(props.thinkingLevel));
  }

  function handleAutoCompactionToggle() {
    if (isDisabled) return;
    callbacks.onToggleAutoCompaction(!props.autoCompactionEnabled);
  }

  // ---- revision ----

  function handleCancelRevision(
    fileInputEl?: HTMLInputElement | null,
    textareaEl?: HTMLTextAreaElement | null,
    rootEl?: HTMLDivElement | null,
  ) {
    const backup = revisionBackup;
    $rx.inputText = backup?.text ?? "";
    if (backup) {
      attachmentSlice.restoreAttachments(backup.attachments);
    } else {
      attachmentSlice.clearAttachments();
    }
    if (fileInputEl) fileInputEl.value = "";
    revisionBackup = null;
    attachmentSlice.clearAttachmentNotice();
    contextSlice.resetDismissedPalettes();
    callbacks.onCancelRevision();
    focusComposer({ textareaEl, rootEl });
  }

  // ---- file input / drag-drop / paste (proxied to slice) ----

  // ---- keyboard / composition ----

  function isCoarsePointer(): boolean {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(pointer: coarse)").matches;
  }

  function isInputComposing(event: KeyboardEvent): boolean {
    return event.isComposing || isComposing || event.keyCode === 229;
  }

  function handleInputCompositionStart() {
    isComposing = true;
  }

  function handleInputCompositionEnd(textareaEl?: HTMLTextAreaElement | null) {
    isComposing = false;
    handleInputInteraction(textareaEl);
  }

  function handleInputInteraction(textareaEl?: HTMLTextAreaElement | null) {
    syncCursorFromTextarea(textareaEl);
  }

  function handleInputKeydown(
    e: KeyboardEvent,
    refs: {
      textareaEl?: HTMLTextAreaElement | null;
      commandPaletteEl?: { handleKeydown: (e: KeyboardEvent) => void } | null;
      mentionPaletteEl?: { handleKeydown: (e: KeyboardEvent) => void } | null;
    },
    steer: boolean | (() => boolean),
  ) {
    const composing = isInputComposing(e);

    // Shift+Tab → cycle thinking
    if (
      e.key === "Tab" &&
      e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !composing
    ) {
      e.preventDefault();
      handleCycleThinkingLevel();
      return;
    }

    // Palette navigation
    if (
      contextSlice.showCommandPalette &&
      refs.commandPaletteEl &&
      (e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Escape" ||
        (contextSlice.filteredSlashCommands.length > 0 &&
          !composing &&
          ((!e.shiftKey && e.key === "Enter") || e.key === "Tab")))
    ) {
      refs.commandPaletteEl.handleKeydown(e);
      return;
    }

    if (
      contextSlice.showMentionPalette &&
      refs.mentionPaletteEl &&
      (e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Escape" ||
        ((props.workspaceEntriesLoading || contextSlice.mentionSuggestions.length > 0) &&
          !composing &&
          ((!e.shiftKey && e.key === "Enter") || e.key === "Tab")))
    ) {
      refs.mentionPaletteEl.handleKeydown(e);
      return;
    }

    // Escape → abort
    if (e.key === "Escape" && props.isStreaming) {
      e.preventDefault();
      handleAbortAction();
      return;
    }

    // Enter → submit / steer
    // On touch/coarse-pointer devices (phones/tablets), Enter inserts a
    // newline instead of submitting; the Send button is used to submit.
    if (e.key === "Enter") {
      if (composing || e.shiftKey) return;
      if (isCoarsePointer()) return;
      e.preventDefault();
      const isSteer = typeof steer === "function" ? steer() : steer;
      handleSubmit(isSteer);
    }
  }

  // ---- effects ----

  let previousRevision: RevisionPayload | null = null;
  $effect(() => {
    const rev = props.revision;
    if (!rev) {
      revisionBackup = null;
      previousRevision = null;
      return;
    }
    if (!previousRevision && !revisionBackup) {
      revisionBackup = {
        text: $rx.inputText,
        attachments: [...attachmentSlice.attachments],
      };
    }
    $rx.inputText = rev.text;
    attachmentSlice.restoreAttachments(attachmentsFromRpcImages(rev.images));
    previousRevision = rev;
  });

  $effect(() => {
    const payload = props.editQueuedPayload;
    if (!payload) return;
    $rx.inputText = payload.text;
    attachmentSlice.restoreAttachments(attachmentsFromRpcImages(payload.images));
    attachmentSlice.clearAttachmentNotice();
    contextSlice.resetDismissedPalettes();
    revisionBackup = null;
  });

  // ---- return public API ----

  return {
    // attachment state
    get attachments() {
      return attachmentSlice.attachments;
    },
    get isDragActive() {
      return attachmentSlice.isDragActive;
    },
    get attachmentNotice() {
      return attachmentSlice.attachmentNotice;
    },
    get lightboxAttachmentIndex() {
      return attachmentSlice.lightboxAttachmentIndex;
    },
    get lightboxImages() {
      return attachmentSlice.lightboxImages;
    },
    get lightboxOpen() {
      return attachmentSlice.lightboxOpen;
    },

    // attachment derived
    get hasAttachments() {
      return attachmentSlice.hasAttachments;
    },
    get attachmentSummary() {
      return attachmentSlice.attachmentSummary;
    },

    // attachment methods
    addAttachmentsFromFiles: attachmentSlice.addAttachmentsFromFiles,
    removeAttachment: attachmentSlice.removeAttachment,
    clearAttachments: attachmentSlice.clearAttachments,
    openAttachmentLightbox: attachmentSlice.openAttachmentLightbox,
    closeAttachmentLightbox: attachmentSlice.closeAttachmentLightbox,
    showPreviousAttachmentLightboxImage:
      attachmentSlice.showPreviousAttachmentLightboxImage,
    showNextAttachmentLightboxImage:
      attachmentSlice.showNextAttachmentLightboxImage,
    clearAttachmentNotice: attachmentSlice.clearAttachmentNotice,
    setAttachmentNotice: attachmentSlice.setAttachmentNotice,

    // file / drag / paste
    handleFilePickerOpen: attachmentSlice.handleFilePickerOpen,
    handleFileInputChange: attachmentSlice.handleFileInputChange,
    handleInputPaste: attachmentSlice.handleInputPaste,
    handleDragEnter: attachmentSlice.handleDragEnter,
    handleDragOver: attachmentSlice.handleDragOver,
    handleDragLeave: attachmentSlice.handleDragLeave,
    handleDrop: attachmentSlice.handleDrop,

    // context
    get availableSlashCommands() {
      return contextSlice.availableSlashCommands;
    },
    get commandContext() {
      return contextSlice.commandContext;
    },
    get filteredSlashCommands() {
      return contextSlice.filteredSlashCommands;
    },
    get mentionContext() {
      return contextSlice.mentionContext;
    },
    get mentionSuggestions() {
      return contextSlice.mentionSuggestions;
    },
    get showCommandPalette() {
      return contextSlice.showCommandPalette;
    },
    get showMentionPalette() {
      return contextSlice.showMentionPalette;
    },
    handleCommandSelect: contextSlice.handleCommandSelect,
    handleCommandClose: contextSlice.handleCommandClose,
    handleMentionSelect: contextSlice.handleMentionSelect,
    handleMentionClose: contextSlice.handleMentionClose,

    // state
    get isDisabled() {
      return isDisabled;
    },
    get currentModelText() {
      return currentModelText;
    },
    get normalizedInputText() {
      return normalizedInputText;
    },
    get canSubmit() {
      return canSubmit;
    },
    get canAbort() {
      return canAbort;
    },
    get showStopButton() {
      return showStopButton;
    },
    get hasPendingMessages() {
      return hasPendingMessages;
    },

    // methods
    handleSubmit,
    handleAbortAction,
    handleCycleThinkingLevel,
    handleAutoCompactionToggle,
    handleCancelRevision,
    handleInputCompositionStart,
    handleInputCompositionEnd,
    handleInputInteraction,
    handleInputKeydown,
    applyExternalText,
    focusComposer,
    resizeTextarea,
  };
}