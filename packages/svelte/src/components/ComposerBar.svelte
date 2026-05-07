<script lang="ts">
  import type {
    RpcGitRepoState,
    RpcImageContent,
    RpcSlashCommand,
    RpcThinkingLevel,
    RpcWorkspaceEntry,
  } from "@pi-web/bridge/types";
  import Check from "lucide-svelte/icons/check";
  import CornerDownLeft from "lucide-svelte/icons/corner-down-left";
  import ImagePlus from "lucide-svelte/icons/image-plus";
  import Square from "lucide-svelte/icons/square";
  import X from "lucide-svelte/icons/x";
  import type { ConnectionStatus } from "../composables/bridgeStore.svelte";
  import {
    COMPOSER_ATTACHMENT_ACCEPT,
    createComposerAttachments,
    extractSupportedImageFiles,
    formatAttachmentSize,
    toRpcImageContent,
    type ComposerAttachment,
  } from "../utils/attachments";
  import type { RpcModelInfo } from "../utils/models";
  import {
    applySlashCommandCompletion,
    getSlashCommandContext,
    mergeSlashCommandOptions,
    parseCompactSlashCommand,
  } from "../utils/slashCommands";
  import { getNextThinkingLevel } from "../utils/thinkingLevels";
  import {
    applyWorkspaceMentionCompletion,
    getWorkspaceMentionContext,
    getWorkspaceMentionSuggestions,
    type WorkspaceMentionSuggestion,
  } from "../utils/workspaceMentions";
  import CommandPalette from "./CommandPalette.svelte";
  import GitBranchDropdown from "./GitBranchDropdown.svelte";
  import ModelDropdown from "./ModelDropdown.svelte";
  import ThinkingLevelDropdown from "./ThinkingLevelDropdown.svelte";
  import WorkspaceMentionPalette from "./WorkspaceMentionPalette.svelte";

  let {
    connectionStatus = "disconnected" as ConnectionStatus,
    isStreaming = false,
    commands = [] as readonly RpcSlashCommand[],
    workspaceEntries = [] as readonly RpcWorkspaceEntry[],
    workspaceEntriesLoading = false,
    workspaceContextKey = null as string | null,
    ensureWorkspaceEntries = (_?: boolean) =>
      Promise.resolve([] as RpcWorkspaceEntry[]),
    models = [] as readonly RpcModelInfo[],
    selectedModel = null as RpcModelInfo | null,
    thinkingLevel = null as RpcThinkingLevel | null,
    autoCompactionEnabled = false,
    prefillText = null as string | null,
    revision = null as {
      entryId: string;
      text: string;
      preview: string;
      hasImages: boolean;
      images: RpcImageContent[];
    } | null,
    pendingMessageCount = 0,
    editQueuedPayload = null as {
      text: string;
      images: RpcImageContent[];
    } | null,
    onSubmit = (_: {
      message: string;
      images: RpcImageContent[];
      revisionEntryId?: string;
      steer?: boolean;
    }) => {},
    onAbort = () => {},
    onCancelRevision = () => {},
    onSelectModel = (_: RpcModelInfo) => {},
    onSelectThinkingLevel = (_: RpcThinkingLevel) => {},
    onToggleAutoCompaction = (_: boolean) => {},
    gitBranch = null as string | null,
    gitRepoState = null as RpcGitRepoState | null,
    gitRepoLoading = false,
    gitBranchSwitching = false,
    gitActionsDisabled = false,
    refreshGitRepoState = (_?: boolean) =>
      Promise.resolve(null as RpcGitRepoState | null),
    switchGitBranch = (_: string) =>
      Promise.resolve(null as RpcGitRepoState | null),
    createGitBranch = (_: string) =>
      Promise.resolve(null as RpcGitRepoState | null),
  } = $props();

  const MAX_TEXTAREA_HEIGHT = 160;
  const TEXTAREA_HEIGHT_BUFFER = 4;

  let inputText = $state("");
  let composerRootRef = $state<HTMLDivElement | null>(null);
  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let fileInputRef = $state<HTMLInputElement | null>(null);
  let isDisabled = $derived(connectionStatus !== "connected");
  let commandPaletteRef = $state<CommandPalette | null>(null);
  let mentionPaletteRef = $state<WorkspaceMentionPalette | null>(null);
  let attachments = $state<ComposerAttachment[]>([]);
  let isDragActive = $state(false);
  let attachmentNotice = $state<string | null>(null);
  let cursorOffset = $state(0);
  let dismissedCommandKey = $state<string | null>(null);
  let dismissedMentionKey = $state<string | null>(null);
  let isComposing = $state(false);
  let mentionInteractionWorkspaceKey = $state<string | null>(null);

  let commandContext = $derived(
    getSlashCommandContext(inputText, cursorOffset),
  );
  let availableSlashCommands = $derived(mergeSlashCommandOptions([]));
  let filteredSlashCommands = $derived.by(() => {
    if (!commandContext) return [];
    const query = commandContext.query.toLowerCase();
    if (!query) return availableSlashCommands;
    return availableSlashCommands.filter(
      c =>
        c.name.toLowerCase().includes(query) ||
        (c.description ?? "").toLowerCase().includes(query),
    );
  });
  let mentionContext = $derived(
    getWorkspaceMentionContext(inputText, cursorOffset),
  );
  let mentionSuggestions = $derived.by(() => {
    if (!mentionContext) return [];
    return getWorkspaceMentionSuggestions(workspaceEntries, mentionContext);
  });
  let showCommandPalette = $derived.by(() => {
    if (isDisabled || !commandContext) return false;
    return dismissedCommandKey !== getCommandKey(commandContext);
  });
  let showMentionPalette = $derived.by(() => {
    if (showCommandPalette || !mentionContext) return false;
    if (dismissedMentionKey === getMentionKey(mentionContext)) return false;
    if (workspaceEntriesLoading) return true;
    return true;
  });
  let currentModelText = $derived.by(() => {
    if (!selectedModel) return models.length > 0 ? "choose model" : "no models";
    return selectedModel.name ?? selectedModel.id;
  });
  let normalizedInputText = $derived(normalizeSubmittedText(inputText));
  let hasAttachments = $derived(attachments.length > 0);
  let canSubmit = $derived(
    !isDisabled && (normalizedInputText.length > 0 || hasAttachments),
  );
  let canAbort = $derived(!isDisabled && isStreaming);
  let showStopButton = $derived(isStreaming && !canSubmit);
  let hasPendingMessages = $derived(pendingMessageCount > 0);
  let attachmentSummary = $derived.by(() => {
    if (attachmentNotice) return attachmentNotice;
    if (!attachments.length) return "";
    if (attachments.length === 1) return "1 image attached";
    return `${attachments.length} images attached`;
  });

  let revisionBackup = $state<{
    text: string;
    attachments: ComposerAttachment[];
  } | null>(null);

  let attachmentNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  let dragDepth = 0;

  function restoredAttachmentExtension(mimeType: string): string {
    switch (mimeType) {
      case "image/png": return "png";
      case "image/jpeg": return "jpg";
      case "image/gif": return "gif";
      case "image/webp": return "webp";
      default: return "img";
    }
  }

  function restoredAttachmentSize(base64Data: string): number {
    const n = base64Data.replace(/\s+/g, "");
    if (!n) return 0;
    const p = n.endsWith("==") ? 2 : n.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((n.length * 3) / 4) - p);
  }

  function restoredAttachmentId(index: number): string {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `restored_attachment_${Date.now().toString(36)}_${index.toString(36)}_${Math.random().toString(36).slice(2)}`;
  }

  function attachmentsFromRpcImages(
    images: readonly RpcImageContent[] | undefined,
  ): ComposerAttachment[] {
    if (!images?.length) return [];
    return images.map((image, idx) => {
      const ext = restoredAttachmentExtension(image.mimeType);
      return {
        id: restoredAttachmentId(idx),
        type: "image",
        data: image.data,
        mimeType: image.mimeType,
        name: `image-${idx + 1}.${ext}`,
        size: restoredAttachmentSize(image.data),
        previewUrl: `data:${image.mimeType};base64,${image.data}`,
      };
    });
  }

  function normalizeSubmittedText(value: string): string {
    const normalized = value.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    while (lines.length > 0 && lines[0].trim() === "") lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    if (lines.length === 0) return "";
    lines[0] = lines[0].trimStart();
    lines[lines.length - 1] = lines[lines.length - 1].trimEnd();
    return lines.join("\n");
  }

  function getCommandKey(ctx: ReturnType<typeof getSlashCommandContext> | null): string | null {
    if (!ctx) return null;
    return `${ctx.start}:${ctx.query}`;
  }

  function getMentionKey(ctx: ReturnType<typeof getWorkspaceMentionContext> | null): string | null {
    if (!ctx) return null;
    return `${ctx.start}:${ctx.prefix}`;
  }

  function syncCursorFromTextarea() {
    cursorOffset = textareaRef?.selectionStart ?? inputText.length;
  }

  function resizeTextarea() {
    queueMicrotask(() => {
      const el = textareaRef;
      if (!el) return;
      el.style.height = "auto";
      const styles = window.getComputedStyle(el);
      const lineHeight = Number.parseFloat(styles.lineHeight) || 0;
      const pt = Number.parseFloat(styles.paddingTop) || 0;
      const pb = Number.parseFloat(styles.paddingBottom) || 0;
      const minHeight = Math.ceil(lineHeight + pt + pb + TEXTAREA_HEIGHT_BUFFER);
      const nextHeight = Math.min(
        Math.max(el.scrollHeight + TEXTAREA_HEIGHT_BUFFER, minHeight),
        MAX_TEXTAREA_HEIGHT,
      );
      el.style.height = `${nextHeight}px`;
      el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
    });
  }

  function shouldRevealComposer(): boolean {
    if (typeof window === "undefined") return false;
    const el = composerRootRef;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || 0;
    const margin = 24;
    return rect.top < margin || rect.bottom > vh - margin;
  }

  function focusComposer(options?: { reveal?: boolean }) {
    queueMicrotask(() => {
      if (options?.reveal && shouldRevealComposer()) {
        composerRootRef?.scrollIntoView({ behavior: "smooth", block: "end" });
      }
      const el = textareaRef;
      if (!el) return;
      el.focus();
      const cursor = inputText.length;
      el.setSelectionRange(cursor, cursor);
      cursorOffset = cursor;
      resizeTextarea();
    });
  }

  function applyExternalText(text: string, options?: { clearAttachments?: boolean }) {
    inputText = text;
    if (options?.clearAttachments) clearAttachments();
    clearAttachmentNotice();
    dismissedCommandKey = null;
    dismissedMentionKey = null;
    focusComposer({ reveal: true });
  }

  function clearAttachmentNotice() {
    if (attachmentNoticeTimer) { clearTimeout(attachmentNoticeTimer); attachmentNoticeTimer = null; }
    attachmentNotice = null;
  }

  function setAttachmentNotice(message: string | null) {
    clearAttachmentNotice();
    attachmentNotice = message;
    if (!message) return;
    attachmentNoticeTimer = setTimeout(() => {
      attachmentNotice = null;
      attachmentNoticeTimer = null;
    }, 4000);
  }

  async function addAttachmentsFromFiles(files: Iterable<File> | ArrayLike<File> | null | undefined) {
    if (!files) return;
    const incomingFiles = Array.from(files);
    if (!incomingFiles.length) return;
    const { attachments: nextAttachments, rejectedNames } = await createComposerAttachments(incomingFiles);
    if (nextAttachments.length > 0) {
      attachments = [...attachments, ...nextAttachments];
      setAttachmentNotice(null);
    }
    if (rejectedNames.length > 0) {
      setAttachmentNotice(`Skipped unsupported files: ${rejectedNames.join(", ")}`);
    }
  }

  function removeAttachment(id: string) {
    attachments = attachments.filter(a => a.id !== id);
    if (attachments.length === 0) clearAttachmentNotice();
  }

  function clearAttachments() {
    attachments = [];
    if (fileInputRef) fileInputRef.value = "";
  }

  function submitMessage(message: string, steer: boolean = false) {
    onSubmit({
      message,
      images: toRpcImageContent(attachments),
      revisionEntryId: revision?.entryId,
      steer,
    });
    inputText = "";
    cursorOffset = 0;
    dismissedCommandKey = null;
    dismissedMentionKey = null;
    revisionBackup = null;
    clearAttachments();
    clearAttachmentNotice();
    resizeTextarea();
  }

  function handleSubmit(steer: boolean = false) {
    const text = normalizedInputText;
    if ((!text && !hasAttachments) || isDisabled) return;
    if (parseCompactSlashCommand(text) && hasAttachments) {
      setAttachmentNotice("/compact does not accept image attachments");
      return;
    }
    submitMessage(text, steer);
  }

  function handleAbortAction() {
    if (!canAbort) return;
    onAbort();
  }

  function handlePrimaryAction() {
    if (showStopButton) { handleAbortAction(); return; }
    handleSubmit();
  }

  function handleCommandSelect(commandName: string) {
    const cmd = availableSlashCommands.find(c => c.name === commandName);
    const ctx = commandContext;
    if (!cmd || !ctx) return;
    const ns = applySlashCommandCompletion(inputText, ctx, cmd);
    inputText = ns.text;
    dismissedCommandKey = null;
    queueMicrotask(() => {
      const el = textareaRef;
      if (!el) return;
      el.focus();
      el.setSelectionRange(ns.cursor, ns.cursor);
      cursorOffset = ns.cursor;
      resizeTextarea();
    });
  }

  function handleCommandClose() {
    dismissedCommandKey = getCommandKey(commandContext);
  }

  function handleMentionSelect(item: WorkspaceMentionSuggestion) {
    const mention = mentionContext;
    if (!mention) return;
    const ns = applyWorkspaceMentionCompletion(inputText, cursorOffset, mention, item);
    inputText = ns.text;
    dismissedMentionKey = null;
    queueMicrotask(() => {
      const el = textareaRef;
      if (!el) return;
      el.focus();
      el.setSelectionRange(ns.cursor, ns.cursor);
      cursorOffset = ns.cursor;
      resizeTextarea();
    });
  }

  function handleMentionClose() {
    dismissedMentionKey = getMentionKey(mentionContext);
  }

  function handleCycleThinkingLevel() {
    if (isDisabled) return;
    onSelectThinkingLevel(getNextThinkingLevel(thinkingLevel));
  }

  function handleAutoCompactionToggle() {
    if (isDisabled) return;
    onToggleAutoCompaction(!autoCompactionEnabled);
  }

  function handleCancelRevision() {
    const backup = revisionBackup;
    inputText = backup?.text ?? "";
    attachments = backup ? [...backup.attachments] : [];
    if (fileInputRef) fileInputRef.value = "";
    revisionBackup = null;
    clearAttachmentNotice();
    dismissedCommandKey = null;
    dismissedMentionKey = null;
    onCancelRevision();
    focusComposer();
  }

  function handleFilePickerOpen() {
    fileInputRef?.click();
  }

  function handleInputInteraction() {
    syncCursorFromTextarea();
    resizeTextarea();
  }

  async function handleFileInputChange(event: Event) {
    const files = (event.target as HTMLInputElement | null)?.files;
    await addAttachmentsFromFiles(files);
    if (fileInputRef) fileInputRef.value = "";
  }

  function hasFilePayload(dataTransfer: DataTransfer | null): boolean {
    return Array.from(dataTransfer?.types ?? []).includes("Files");
  }

  function extractPastedFiles(event: ClipboardEvent): File[] {
    const directFiles = extractSupportedImageFiles(event.clipboardData?.files);
    if (directFiles.length > 0) return directFiles;
    const pastedFiles = Array.from(event.clipboardData?.items ?? [])
      .filter(i => i.kind === "file")
      .map(i => i.getAsFile())
      .filter((f): f is File => f !== null);
    return extractSupportedImageFiles(pastedFiles);
  }

  async function handleInputPaste(event: ClipboardEvent) {
    const pastedFiles = extractPastedFiles(event);
    if (pastedFiles.length === 0) return;
    event.preventDefault();
    await addAttachmentsFromFiles(pastedFiles);
  }

  function handleDragEnter(event: DragEvent) {
    if (!hasFilePayload(event.dataTransfer)) return;
    dragDepth += 1;
    isDragActive = true;
  }

  function handleDragOver(event: DragEvent) {
    if (!hasFilePayload(event.dataTransfer)) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    isDragActive = true;
  }

  function handleDragLeave(event: DragEvent) {
    if (!hasFilePayload(event.dataTransfer)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) isDragActive = false;
  }

  async function handleDrop(event: DragEvent) {
    dragDepth = 0;
    isDragActive = false;
    await addAttachmentsFromFiles(event.dataTransfer?.files);
  }

  function isInputComposing(event: KeyboardEvent): boolean {
    return event.isComposing || isComposing || event.keyCode === 229;
  }

  function handleInputCompositionStart() { isComposing = true; }
  function handleInputCompositionEnd() { isComposing = false; handleInputInteraction(); }

  function handleInputKeydown(e: KeyboardEvent) {
    const composing = isInputComposing(e);

    if (e.key === "Tab" && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !composing) {
      e.preventDefault();
      handleCycleThinkingLevel();
      return;
    }

    if (
      showCommandPalette && commandPaletteRef &&
      (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Escape" ||
        (filteredSlashCommands.length > 0 && !composing &&
          ((!e.shiftKey && e.key === "Enter") || e.key === "Tab")))
    ) {
      commandPaletteRef.handleKeydown(e);
      return;
    }

    if (
      showMentionPalette && mentionPaletteRef &&
      (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Escape" ||
        ((workspaceEntriesLoading || mentionSuggestions.length > 0) && !composing &&
          ((!e.shiftKey && e.key === "Enter") || e.key === "Tab")))
    ) {
      mentionPaletteRef.handleKeydown(e);
      return;
    }

    if (e.key === "Escape" && isStreaming) {
      e.preventDefault();
      handleAbortAction();
      return;
    }

    if (e.key === "Enter") {
      if (composing || e.shiftKey) return;
      e.preventDefault();
      handleSubmit(isStreaming);
    }
  }

  // Effects
  $effect(() => {
    void inputText;
    resizeTextarea();
    queueMicrotask(() => syncCursorFromTextarea());
  });

  $effect(() => {
    const cmdKey = getCommandKey(commandContext);
    if (cmdKey && cmdKey !== (dismissedCommandKey ?? undefined)) dismissedCommandKey = null;
  });

  $effect(() => {
    void [mentionContext, workspaceContextKey];
    const mk = getMentionKey(mentionContext);
    if (mk && mk !== (dismissedMentionKey ?? undefined)) dismissedMentionKey = null;

    if (!mentionContext) { mentionInteractionWorkspaceKey = null; return; }
    const nik = `${workspaceContextKey ?? ""}:${mentionContext.start}`;
    if (mentionInteractionWorkspaceKey === nik) return;
    mentionInteractionWorkspaceKey = nik;
    void ensureWorkspaceEntries();
  });

  $effect(() => {
    if (typeof prefillText === "string") applyExternalText(prefillText);
  });

  let previousRevision: typeof revision = null;
  $effect(() => {
    void revision;
    if (!revision) {
      revisionBackup = null;
      previousRevision = null;
      return;
    }
    if (!previousRevision && !revisionBackup) {
      revisionBackup = {
        text: inputText,
        attachments: [...attachments],
      };
    }
    applyExternalText(revision.text);
    attachments = attachmentsFromRpcImages(revision.images);
    if (fileInputRef) fileInputRef.value = "";
    previousRevision = revision;
  });

  $effect(() => {
    void editQueuedPayload;
    if (!editQueuedPayload) return;
    inputText = editQueuedPayload.text;
    attachments = attachmentsFromRpcImages(editQueuedPayload.images);
    if (fileInputRef) fileInputRef.value = "";
    clearAttachmentNotice();
    dismissedCommandKey = null;
    dismissedMentionKey = null;
    revisionBackup = null;
    focusComposer({ reveal: true });
  });

  resizeTextarea();
</script>

<div bind:this={composerRootRef} class="composer-bar">
  <div class="composer-inner-wrap">
    {#if showCommandPalette}
      <CommandPalette
        bind:this={commandPaletteRef}
        commands={availableSlashCommands}
        filter={commandContext?.query ?? ""}
        onSelect={handleCommandSelect}
        onClose={handleCommandClose}
      />
    {:else if showMentionPalette}
      <WorkspaceMentionPalette
        bind:this={mentionPaletteRef}
        items={mentionSuggestions}
        loading={workspaceEntriesLoading}
        onSelect={handleMentionSelect}
        onClose={handleMentionClose}
      />
    {/if}

    <div
      class="composer-dock"
      class:disabled={isDisabled}
      class:drag-active={isDragActive}
      ondragenter={handleDragEnter}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={handleDrop}
    >
      {#if revision}
        <div class="revision-banner">
          <div class="revision-banner-copy">
            <p class="revision-preview">{revision.preview}</p>
          </div>
          <button
            type="button"
            class="revision-cancel-button"
            onclick={handleCancelRevision}
          >
            Cancel
          </button>
        </div>
      {/if}

      <input
        bind:this={fileInputRef}
        class="hidden-file-input"
        type="file"
        multiple
        accept={COMPOSER_ATTACHMENT_ACCEPT}
        onchange={handleFileInputChange}
      />

      {#if attachments.length > 0}
        <div class="attachment-strip">
          {#each attachments as attachment (attachment.id)}
            <div class="attachment-chip">
              <img
                class="attachment-chip-preview"
                src={attachment.previewUrl}
                alt={attachment.name}
              />
              <div class="attachment-chip-body">
                <span class="attachment-chip-name">{attachment.name}</span>
                <span class="attachment-chip-meta">
                  {formatAttachmentSize(attachment.size)}
                </span>
              </div>
              <button
                type="button"
                class="attachment-chip-remove"
                aria-label={`Remove ${attachment.name}`}
                onclick={() => removeAttachment(attachment.id)}
              >
                <X class="attachment-chip-remove-icon" aria-hidden="true" size={14} />
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="composer-main-row">
        <button
          type="button"
          class="attach-btn"
          title={hasAttachments ? "Add more images" : "Attach images"}
          onclick={handleFilePickerOpen}
        >
          <ImagePlus class="attach-icon" aria-hidden="true" size={16} />
        </button>
        <textarea
          bind:this={textareaRef}
          bind:value={inputText}
          class="prompt-input"
          rows="1"
          disabled={isDisabled}
          placeholder="Ask anything, or drop an image"
          onkeydown={handleInputKeydown}
          oninput={handleInputInteraction}
          onkeyup={handleInputInteraction}
          onclick={handleInputInteraction}
          oncompositionstart={handleInputCompositionStart}
          oncompositionend={handleInputCompositionEnd}
          onselect={handleInputInteraction}
          onfocus={handleInputInteraction}
          onpaste={handleInputPaste}
        />
      </div>

      <div class="composer-footer-row">
        <div class="composer-status-cluster">
          <GitBranchDropdown
            label={gitBranch}
            repoState={gitRepoState}
            loading={gitRepoLoading}
            switching={gitBranchSwitching}
            disabled={gitActionsDisabled}
            refresh={refreshGitRepoState}
            switchBranch={switchGitBranch}
            createBranch={createGitBranch}
          />
          <ModelDropdown
            {models}
            {selectedModel}
            label={currentModelText}
            disabled={isDisabled}
            onSelect={(model: RpcModelInfo) => onSelectModel(model)}
          />
          <ThinkingLevelDropdown
            value={thinkingLevel}
            disabled={isDisabled}
            onSelect={(level: RpcThinkingLevel) => onSelectThinkingLevel(level)}
          />
          <button
            type="button"
            class="toggle-chip"
            class:disabled={isDisabled}
            class:checked={autoCompactionEnabled}
            disabled={isDisabled}
            aria-pressed={autoCompactionEnabled}
            onclick={handleAutoCompactionToggle}
          >
            <span class="toggle-chip-icon" aria-hidden="true">
              {#if autoCompactionEnabled}
                <Check size={11} strokeWidth={2.5} />
              {/if}
            </span>
            <span class="toggle-chip-label">Auto compact</span>
          </button>
        </div>
        <div class="composer-action-cluster">
          {#if attachmentSummary}
            <span class="attachment-summary">{attachmentSummary}</span>
          {/if}
          {#if hasPendingMessages}
            <div
              class="pending-queue-indicator"
              title={`${pendingMessageCount} message${pendingMessageCount > 1 ? "s" : ""} queued`}
            >
              <span class="pending-pulse"></span>
              <span class="pending-label">{pendingMessageCount}</span>
            </div>
          {/if}
          <button
            class="send-btn"
            class:stop={showStopButton}
            disabled={showStopButton ? !canAbort : !canSubmit}
            aria-label={showStopButton ? "Stop response" : "Send message"}
            onclick={handlePrimaryAction}
          >
            {#if showStopButton}
              <Square class="send-icon stop-icon" aria-hidden="true" size={13} />
            {:else}
              <CornerDownLeft class="send-icon" aria-hidden="true" size={15} />
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .composer-bar {
    flex-shrink: 0;
    padding: 6px 24px 12px;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
    background: var(--bg);
  }

  .composer-inner-wrap {
    position: relative;
    width: min(960px, 100%);
    margin: 0 auto;
  }

  .composer-dock {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 6px;
    border-radius: 18px;
    border: 1px solid var(--border);
    background: var(--bg);
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }

  .revision-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--border-strong) 82%, transparent);
    background: color-mix(in srgb, var(--panel-2) 88%, transparent);
  }

  .revision-banner-copy { min-width: 0; }

  .revision-preview {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--text);
  }

  .revision-cancel-button {
    flex-shrink: 0;
    height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-muted);
    font-size: 0.7rem;
    cursor: pointer;
    transition:
      border-color 0.12s ease,
      color 0.12s ease,
      background 0.12s ease;
  }

  .revision-cancel-button:hover {
    border-color: var(--border-strong);
    background: var(--bg);
    color: var(--text);
  }

  .composer-dock:focus-within {
    border-color: var(--border-strong);
    background: var(--bg);
  }

  .composer-dock.drag-active {
    border-color: color-mix(in srgb, var(--accent) 36%, var(--border-strong));
    background: var(--bg);
  }

  .composer-dock.disabled { opacity: 0.74; }

  .hidden-file-input { display: none; }

  .attachment-strip {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 2px 2px 0;
    scrollbar-width: thin;
  }

  .attachment-chip {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    border-radius: 14px;
    background: color-mix(in srgb, var(--panel) 74%, transparent);
  }

  .attachment-chip-preview {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    object-fit: cover;
    background: var(--panel);
    border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
  }

  .attachment-chip-body {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .attachment-chip-name,
  .attachment-chip-meta,
  .attachment-summary { font-family: var(--pi-font-mono); }

  .pending-queue-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--border-strong) 60%, transparent);
    background: color-mix(in srgb, var(--panel-2) 80%, transparent);
    color: var(--text-subtle);
    font-size: 0.68rem;
    user-select: none;
  }

  .pending-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--warning);
    animation: pending-pulse 1.4s ease-in-out infinite;
  }

  .pending-label {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  @keyframes pending-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }

  .attachment-chip-name {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.72rem;
    color: var(--text);
  }

  .attachment-chip-meta,
  .attachment-summary {
    font-size: 0.64rem;
    color: var(--text-subtle);
  }

  .attachment-chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
    background: transparent;
    color: var(--text-subtle);
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .attach-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    margin-top: 8px;
    border-radius: 10px;
    border: none;
    background: var(--bg);
    color: var(--text-subtle);
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease,
      opacity 0.15s ease;
  }

  .attachment-chip-remove:hover,
  .attach-btn:hover:not(:disabled) {
    background: var(--bg);
    color: var(--text);
  }

  .composer-main-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    min-width: 0;
  }

  .prompt-input {
    display: block;
    box-sizing: border-box;
    flex: 1;
    min-width: 0;
    max-height: 160px;
    padding: 9px 0 10px;
    border: none;
    background: transparent;
    color: var(--text);
    font-family: var(--pi-font-sans);
    font-size: 0.94rem;
    font-weight: 400;
    line-height: 1.55;
    outline: none;
    resize: none;
    overflow-y: hidden;
    scrollbar-gutter: stable;
  }

  .prompt-input:disabled,
  .attach-btn:disabled { cursor: not-allowed; }

  .prompt-input::placeholder {
    color: var(--text-subtle);
    line-height: inherit;
  }

  .send-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 25px;
    height: 25px;
    border-radius: 12px;
    border: none;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      opacity 0.15s ease,
      transform 0.15s ease;
  }

  .send-btn:hover:not(:disabled) {
    background: var(--bg);
    transform: translateY(-1px);
  }

  .send-btn.stop {
    background: var(--bg);
    color: var(--error-text);
  }

  .send-btn.stop:hover:not(:disabled) {
    background: var(--bg);
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .stop-icon { width: 13px; height: 13px; }

  .composer-footer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
    min-width: 0;
  }

  .composer-status-cluster,
  .composer-action-cluster {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .composer-action-cluster { justify-content: flex-end; }

  .toggle-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    border: none;
    background: var(--bg);
    color: var(--text-subtle);
    cursor: pointer;
    user-select: none;
    font: inherit;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease,
      transform 0.15s ease;
  }

  .toggle-chip:hover:not(.disabled) {
    background: var(--bg);
    color: var(--text);
  }

  .toggle-chip:focus-visible {
    background: var(--bg);
    color: var(--text);
    outline: none;
  }

  .toggle-chip.disabled { opacity: 0.45; cursor: not-allowed; }

  .toggle-chip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--border-strong) 72%, transparent);
    background: transparent;
    color: var(--bg);
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      color 0.15s ease;
  }

  .toggle-chip.checked {
    color: var(--text);
  }

  .toggle-chip.checked .toggle-chip-icon {
    border-color: color-mix(in srgb, var(--text) 72%, transparent);
    background: var(--text);
    color: var(--bg);
  }

  .toggle-chip-label {
    font-family: var(--pi-font-sans);
    font-size: 0.66rem;
    white-space: nowrap;
  }

  @media (max-width: 900px) {
    .composer-bar {
      position: sticky;
      bottom: 0;
      z-index: 10;
      padding: 10px 16px 12px;
      padding-bottom: max(12px, env(safe-area-inset-bottom));
    }

    .composer-inner-wrap { width: 100%; }
    .prompt-input { font-size: 16px; }

    .composer-footer-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
    }

    .composer-status-cluster {
      min-width: 0;
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: none;
    }

    .composer-status-cluster::-webkit-scrollbar { display: none; }

    .composer-action-cluster {
      flex-shrink: 0;
      justify-content: flex-end;
    }

    .attachment-summary { display: none; }
  }

  @media (max-width: 640px) {
    .composer-bar {
      padding: 8px 12px 10px;
      padding-bottom: max(10px, env(safe-area-inset-bottom));
    }

    .revision-banner { flex-direction: column; }
    .revision-cancel-button { align-self: flex-start; }

    .composer-dock { gap: 8px; padding: 8px 10px; border-radius: 16px; }
    .attachment-chip { min-width: 200px; }

    .composer-main-row { gap: 8px; align-items: flex-end; }

    .attach-btn {
      width: 26px;
      height: 26px;
      margin-top: 0;
      border-radius: 10px;
    }

    .prompt-input { padding: 5px 0 6px; line-height: 1.5; }
    .composer-footer-row { gap: 8px; padding-top: 8px; }

    .send-btn { width: 32px; height: 32px; border-radius: 10px; }
  }
</style>
