<script lang="ts">
  import type {
    RpcGitBranch,
    RpcGitRepoEntry,
    RpcGitRepoState,
    RpcImageContent,
    RpcSlashCommand,
    RpcThinkingLevel,
    RpcWorkspaceEntry,
  } from "@pi-web/bridge/types";
  import ImagePlus from "lucide-svelte/icons/image-plus";
  import type { ConnectionStatus } from "../composables/bridgeStore.svelte";
  import { COMPOSER_ATTACHMENT_ACCEPT } from "../utils/attachments";
  import type { RpcModelInfo } from "../utils/models";
  import CommandPalette from "./CommandPalette.svelte";
  import ComposerBarAttachmentStrip from "./ComposerBarAttachmentStrip.svelte";
  import ComposerBarFooter from "./ComposerBarFooter.svelte";
  import ComposerBarRevisionBanner from "./ComposerBarRevisionBanner.svelte";
  import ImageLightbox from "./ImageLightbox.svelte";
  import WorkspaceMentionPalette from "./WorkspaceMentionPalette.svelte";
  import { createComposerBarState } from "./composerBarState.svelte";

  let {
    connectionStatus = "disconnected" as ConnectionStatus,
    isStreaming = false,
    isDebugMode = false,
    isDebugSession = false,
    commands = [] as readonly RpcSlashCommand[],
    workspaceEntries = [] as readonly RpcWorkspaceEntry[],
    workspaceEntriesLoading = false,
    workspaceContextKey = null as string | null,
    ensureWorkspaceEntries = ((_force?: boolean) => Promise.resolve([] as RpcWorkspaceEntry[])) as (force?: boolean) => Promise<RpcWorkspaceEntry[]>,
    models = [] as readonly RpcModelInfo[],
    selectedModel = null as RpcModelInfo | null,
    thinkingLevel = null as RpcThinkingLevel | null,
    autoCompactionEnabled = false,
    prefillText = null as string | null,
    revision = null as { entryId: string; text: string; preview: string; hasImages: boolean; images: RpcImageContent[] } | null,
    pendingMessageCount = 0,
    editQueuedPayload = null as { text: string; images: RpcImageContent[] } | null,
    onInteraction = (() => {}) as () => void,
    onSubmit = ((_: { message: string; images: RpcImageContent[]; revisionEntryId?: string; steer?: boolean }) => {}) as (payload: { message: string; images: RpcImageContent[]; revisionEntryId?: string; steer?: boolean }) => void,
    onAbort = (() => {}) as () => void,
    onCancelRevision = (() => {}) as () => void,
    onSelectModel = ((_: RpcModelInfo) => {}) as (model: RpcModelInfo) => void,
    onSelectThinkingLevel = ((_: RpcThinkingLevel) => {}) as (level: RpcThinkingLevel) => void,
    onToggleAutoCompaction = ((_: boolean) => {}) as (enabled: boolean) => void,
    gitBranch = null as string | null,
    gitRepoState = null as RpcGitRepoState | null,
    gitRepoLoading = false,
    gitBranchSwitching = false,
    gitActionsDisabled = false,
    gitRepos = [] as readonly RpcGitRepoEntry[],
    gitReposLoading = false,
    gitRepoStateByRoot = {} as Readonly<Record<string, RpcGitRepoState>>,
    gitRepoStateLoadingByRoot = {} as Readonly<Record<string, boolean>>,
    selectedGitRepoRoot = null as string | null,
    refreshGitRepoState = ((_?: string | null, __?: boolean) => Promise.resolve(null as RpcGitRepoState | null)) as (repoRoot?: string | null, force?: boolean) => Promise<RpcGitRepoState | null>,
    switchGitBranch = ((_: string, __?: string | null) => Promise.resolve(null as RpcGitRepoState | null)) as (branchName: string, repoRoot?: string | null) => Promise<RpcGitRepoState | null>,
    createGitBranch = ((_: string, __?: string | null) => Promise.resolve(null as RpcGitRepoState | null)) as (branchName: string, repoRoot?: string | null) => Promise<RpcGitRepoState | null>,
    onPickGitRepo = ((_: string | null) => {}) as (repoRoot: string | null) => void,
    onPickGitBranch = ((_: string, __: RpcGitBranch) => Promise.resolve()) as (repoRoot: string, branch: RpcGitBranch) => Promise<void>,
    onCreateGitBranch = ((_: string, __: string) => Promise.resolve()) as (repoRoot: string, name: string) => Promise<void>,
  } = $props();

  const refreshGitRepoStateForSingleRepo = (force?: boolean) =>
    refreshGitRepoState(undefined, force);

  let composerPlaceholder = $derived(
    isDebugMode && isDebugSession
      ? "Use /fixture, /tps, /json, or type synthetic markdown"
      : "Ask anything, or drop an image",
  );

  // ---- DOM refs (must stay in .svelte for bind:this) ----
  let composerRootRef = $state<HTMLDivElement | null>(null);
  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let fileInputRef = $state<HTMLInputElement | null>(null);
  let commandPaletteRef = $state<CommandPalette | null>(null);
  let mentionPaletteRef = $state<WorkspaceMentionPalette | null>(null);

  // ---- reactive primitives owned by the component (needed for bind:) ----
  let inputText = $state("");
  let cursorOffset = $state(0);

  // ---- state module (reads/writes inputText & cursorOffset through $rx) ----
  const composer = createComposerBarState(
    {
      get connectionStatus() { return connectionStatus; },
      get isStreaming() { return isStreaming; },
      get isDebugMode() { return isDebugMode; },
      get commands() { return commands; },
      get workspaceEntries() { return workspaceEntries; },
      get workspaceEntriesLoading() { return workspaceEntriesLoading; },
      get workspaceContextKey() { return workspaceContextKey; },
      get ensureWorkspaceEntries() { return ensureWorkspaceEntries; },
      get models() { return models; },
      get selectedModel() { return selectedModel; },
      get thinkingLevel() { return thinkingLevel; },
      get autoCompactionEnabled() { return autoCompactionEnabled; },
      get prefillText() { return prefillText; },
      get revision() { return revision; },
      get pendingMessageCount() { return pendingMessageCount; },
      get editQueuedPayload() { return editQueuedPayload; },
    },
    {
      get onSubmit() { return onSubmit; },
      get onAbort() { return onAbort; },
      get onCancelRevision() { return onCancelRevision; },
      get onSelectModel() { return onSelectModel; },
      get onSelectThinkingLevel() { return onSelectThinkingLevel; },
      get onToggleAutoCompaction() { return onToggleAutoCompaction; },
    },
    {
      get inputText() { return inputText; },
      set inputText(v: string) { inputText = v; },
      get cursorOffset() { return cursorOffset; },
      set cursorOffset(v: number) { cursorOffset = v; },
    },
  );

  // ---- event handler glue (wires state methods to DOM refs) ----

  function handleFilePickerOpen() {
    composer.handleFilePickerOpen(fileInputRef);
  }

  async function handleFileInputChange(event: Event) {
    await composer.handleFileInputChange(event, fileInputRef);
  }

  function handleInputInteraction() {
    composer.handleInputInteraction(textareaRef);
    onInteraction();
  }

  function handleInputCompositionStart() {
    composer.handleInputCompositionStart();
  }

  function handleInputCompositionEnd() {
    composer.handleInputCompositionEnd(textareaRef);
  }

  async function handleInputPaste(event: ClipboardEvent) {
    await composer.handleInputPaste(event);
  }

  function handleInputKeydown(e: KeyboardEvent) {
    composer.handleInputKeydown(e, {
      textareaEl: textareaRef,
      commandPaletteEl: commandPaletteRef,
      mentionPaletteEl: mentionPaletteRef,
    }, isStreaming);
  }

  function handleCommandSelect(commandName: string) {
    composer.handleCommandSelect(commandName, textareaRef);
  }

  function handleMentionSelect(item: Parameters<typeof composer.handleMentionSelect>[0]) {
    composer.handleMentionSelect(item, textareaRef);
  }

  function handleCancelRevision() {
    composer.handleCancelRevision(fileInputRef, textareaRef, composerRootRef);
  }

  function handlePrimaryAction() {
    if (composer.showStopButton) {
      composer.handleAbortAction();
      return;
    }
    composer.handleSubmit(false, fileInputRef, textareaRef);
  }

  // ---- effects that need DOM refs ----

  $effect(() => {
    // Resize textarea on input change
    void inputText;
    composer.resizeTextarea(textareaRef);
  });

  $effect(() => {
    if (typeof prefillText === "string") {
      composer.applyExternalText(prefillText, {
        fileInputEl: fileInputRef,
        textareaEl: textareaRef,
        rootEl: composerRootRef,
      });
    }
  });

  $effect(() => {
    void editQueuedPayload;
    if (editQueuedPayload) {
      composer.focusComposer({
        textareaEl: textareaRef,
        rootEl: composerRootRef,
        reveal: true,
      });
    }
  });

  // Initial resize
  $effect(() => {
    composer.resizeTextarea(textareaRef);
  });
</script>

<div bind:this={composerRootRef} class="composer-bar">
  <div class="composer-inner-wrap">
    {#if composer.showCommandPalette}
      <CommandPalette
        bind:this={commandPaletteRef}
        commands={composer.availableSlashCommands}
        filter={composer.commandContext?.query ?? ""}
        isDebugMode={isDebugMode}
        onSelect={handleCommandSelect}
        onClose={composer.handleCommandClose}
      />
    {:else if composer.showMentionPalette}
      <WorkspaceMentionPalette
        bind:this={mentionPaletteRef}
        items={composer.mentionSuggestions}
        loading={workspaceEntriesLoading}
        onSelect={handleMentionSelect}
        onClose={composer.handleMentionClose}
      />
    {/if}

    <div
      class="composer-dock"
      class:disabled={composer.isDisabled}
      class:drag-active={composer.isDragActive}
      role="region"
      aria-label="Message composer"
      ondragenter={composer.handleDragEnter}
      ondragover={composer.handleDragOver}
      ondragleave={composer.handleDragLeave}
      ondrop={composer.handleDrop}
    >
      <ComposerBarRevisionBanner {revision} onCancel={handleCancelRevision} />

      <input
        bind:this={fileInputRef}
        class="hidden-file-input"
        type="file"
        multiple
        accept={COMPOSER_ATTACHMENT_ACCEPT}
        onchange={handleFileInputChange}
      />

      <ComposerBarAttachmentStrip {composer} />

      <div class="composer-main-row">
        <button
          type="button"
          class="attach-btn"
          title={composer.hasAttachments ? "Add more images" : "Attach images"}
          onclick={handleFilePickerOpen}
        >
          <ImagePlus class="attach-icon" aria-hidden="true" size={16} />
        </button>
        <textarea
          bind:this={textareaRef}
          bind:value={inputText}
          class="prompt-input"
          rows="1"
          disabled={composer.isDisabled}
          placeholder={composerPlaceholder}
          onkeydown={handleInputKeydown}
          oninput={handleInputInteraction}
          onkeyup={handleInputInteraction}
          onclick={handleInputInteraction}
          oncompositionstart={handleInputCompositionStart}
          oncompositionend={handleInputCompositionEnd}
          onselect={handleInputInteraction}
          onfocus={handleInputInteraction}
          onpaste={handleInputPaste}
        ></textarea>
      </div>

      <ComposerBarFooter
        {composer}
        {isDebugSession}
        {models}
        {selectedModel}
        {thinkingLevel}
        {autoCompactionEnabled}
        {pendingMessageCount}
        {gitBranch}
        {gitRepoState}
        {gitRepoLoading}
        {gitBranchSwitching}
        {gitActionsDisabled}
        {gitRepos}
        {gitReposLoading}
        {gitRepoStateByRoot}
        {gitRepoStateLoadingByRoot}
        {selectedGitRepoRoot}
        refreshGitRepoStateForSingleRepo={refreshGitRepoStateForSingleRepo}
        {refreshGitRepoState}
        {switchGitBranch}
        {createGitBranch}
        {onPickGitRepo}
        {onPickGitBranch}
        {onCreateGitBranch}
        {onSelectModel}
        {onSelectThinkingLevel}
        onPrimaryAction={handlePrimaryAction}
      />
    </div>
  </div>
</div>

<ImageLightbox
  open={composer.lightboxOpen}
  images={composer.lightboxImages}
  index={composer.lightboxAttachmentIndex}
  onClose={composer.closeAttachmentLightbox}
  onPrevious={composer.showPreviousAttachmentLightboxImage}
  onNext={composer.showNextAttachmentLightboxImage}
/>

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

  .composer-dock:focus-within {
    border-color: var(--border-strong);
    background: var(--bg);
  }

  .composer-dock.drag-active {
    border-color: color-mix(in srgb, var(--accent) 36%, var(--border-strong));
    background: var(--bg);
  }

  .composer-dock.disabled {
    opacity: 0.74;
  }

  .hidden-file-input {
    display: none;
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

  .prompt-input:disabled {
    cursor: not-allowed;
  }

  .prompt-input::placeholder {
    color: var(--text-subtle);
    line-height: inherit;
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

  .attach-btn:disabled {
    cursor: not-allowed;
  }

  .attach-btn:hover:not(:disabled) {
    background: var(--bg);
    color: var(--text);
  }

  .attach-btn:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 54%, white 12%);
    outline-offset: 2px;
  }

  @media (max-width: 900px) {
    .composer-bar {
      position: sticky;
      bottom: 0;
      z-index: 10;
      padding: 10px 16px 12px;
      padding-bottom: max(12px, env(safe-area-inset-bottom));
    }

    .composer-inner-wrap {
      width: 100%;
    }

    .prompt-input {
      font-size: 16px;
    }
  }

  @media (max-width: 640px) {
    .composer-bar {
      padding: 8px 12px 10px;
      padding-bottom: max(10px, env(safe-area-inset-bottom));
    }

    .composer-dock {
      gap: 8px;
      padding: 8px 10px;
      border-radius: 16px;
    }

    .composer-main-row {
      gap: 8px;
      align-items: flex-end;
    }

    .attach-btn {
      width: 26px;
      height: 39px;
      margin-top: 0;
      border-radius: 10px;
    }

    .prompt-input {
      padding: 5px 0 6px;
      line-height: 1.5;
    }
  }
</style>