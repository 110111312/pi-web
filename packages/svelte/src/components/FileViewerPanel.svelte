<script lang="ts">
  import type { RpcDiffEntry, RpcWorkspaceFile } from "@pi-web/bridge/types";
  import { onMount, tick } from "svelte";
  import { highlightCodeLinesHtml } from "../utils/codeHighlight";
  import FileViewerCodeContent from "./FileViewerCodeContent.svelte";
  import FileViewerDiffContent from "./FileViewerDiffContent.svelte";
  import FileViewerDiscardConfirm from "./FileViewerDiscardConfirm.svelte";
  import FileViewerEditor from "./FileViewerEditor.svelte";
  import FileViewerToolbar from "./FileViewerToolbar.svelte";

  type WriteResult = {
    path: string;
    absolutePath: string;
    bytesWritten: number;
  };

  let {
    filePath = "",
    lineNumber = 1,
    readWorkspaceFile = (_: string) =>
      Promise.resolve({} as RpcWorkspaceFile),
    writeWorkspaceFile = (_: string, __: string) =>
      Promise.resolve({
        path: "",
        absolutePath: "",
        bytesWritten: 0,
      } satisfies WriteResult),
    onClose,
    diffEntry = null,
  }: {
    filePath: string;
    lineNumber: number;
    readWorkspaceFile: (path: string) => Promise<RpcWorkspaceFile>;
    writeWorkspaceFile?: (
      path: string,
      content: string,
    ) => Promise<WriteResult>;
    onClose: () => void;
    diffEntry?: RpcDiffEntry | null;
  } = $props();

  let container = $state<HTMLDivElement | null>(null);
  let textarea = $state<HTMLTextAreaElement | null>(null);
  let file = $state<RpcWorkspaceFile | null>(null);
  let renderedHtml = $state("");
  let loading = $state(false);
  let errorMessage = $state("");
  let loadVersion = 0;
  let renderVersion = 0;
  let themeObserver: MutationObserver | undefined;

  // Edit mode state
  let isEditing = $state(false);
  let editedContent = $state("");
  let isSaving = $state(false);
  let saveError = $state("");
  let pendingDiscard = $state(false); // shows unsaved-changes confirmation

  // View mode toggle (only meaningful when diffEntry is provided)
  let viewMode = $state<"diff" | "file">("file");

  let activeDiffEntry = $derived(diffEntry ?? null);

  $effect(() => {
    // When diffEntry changes, default to diff view; when cleared, default to file.
    viewMode = activeDiffEntry ? "diff" : "file";
  });

  let activeLineNumber = $derived(
    Number.isInteger(lineNumber) && lineNumber > 0 ? lineNumber : 1,
  );

  let isDirty = $derived(
    isEditing && file !== null && editedContent !== file.content,
  );

  let canEdit = $derived(
    file !== null && !file.truncated && file.path !== "",
  );

  async function loadFile() {
    const version = ++loadVersion;
    loading = true;
    errorMessage = "";
    file = null;
    renderedHtml = "";
    // Reset edit state when loading a new file.
    isEditing = false;
    editedContent = "";
    saveError = "";

    try {
      const nextFile = await readWorkspaceFile(filePath);
      if (version !== loadVersion) return;
      file = nextFile;
      editedContent = nextFile.content;
    } catch (error) {
      if (version !== loadVersion) return;
      file = null;
      errorMessage =
        error instanceof Error ? error.message : "Failed to load file preview";
      renderedHtml = "";
    } finally {
      if (version === loadVersion) loading = false;
    }
  }

  async function scrollToActiveLine() {
    await tick();

    const root = container;
    if (!root) return;

    const target = root.querySelector<HTMLElement>(
      `[data-line="${activeLineNumber}"]`,
    );
    if (!target) return;

    target.scrollIntoView({ block: "center" });
  }

  async function renderCode() {
    const version = ++renderVersion;
    if (!file) {
      renderedHtml = "";
      return;
    }

    const html = await highlightCodeLinesHtml(
      file.content,
      file.path,
      undefined,
      activeLineNumber,
    );
    if (version !== renderVersion) return;

    renderedHtml = html;
    await scrollToActiveLine();
  }

  function enterEditMode() {
    if (!canEdit) return;
    editedContent = file?.content ?? "";
    saveError = "";
    isEditing = true;
    // Focus textarea next tick.
    queueMicrotask(() => textarea?.focus());
  }

  function attemptExitEditMode() {
    if (isDirty) {
      pendingDiscard = true;
      return;
    }
    isEditing = false;
    saveError = "";
  }

  function confirmDiscard() {
    pendingDiscard = false;
    isEditing = false;
    editedContent = file?.content ?? "";
    saveError = "";
  }

  function cancelDiscard() {
    pendingDiscard = false;
  }

  async function saveFile() {
    if (!file || isSaving) return;
    isSaving = true;
    saveError = "";
    try {
      await writeWorkspaceFile(file.path, editedContent);
      // Update the file object so the read view re-renders with new content.
      file = {
        ...file,
        content: editedContent,
        lineCount: editedContent.split(/\r?\n/).length,
      };
      isEditing = false;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save file";
      saveError = message;
    } finally {
      isSaving = false;
    }
  }

  function onEditorKeydown(event: KeyboardEvent) {
    if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (isDirty && !isSaving) {
        void saveFile();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      attemptExitEditMode();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const target = event.currentTarget as HTMLTextAreaElement;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      // Insert 2 spaces at the cursor (or replace selection).
      const insert = "  ";
      editedContent =
        editedContent.substring(0, start) +
        insert +
        editedContent.substring(end);
      queueMicrotask(() => {
        target.selectionStart = target.selectionEnd = start + insert.length;
      });
    }
  }

  onMount(() => {
    const shell = document.querySelector(".app-shell");
    if (!shell) return;

    themeObserver = new MutationObserver(() => {
      void renderCode();
    });
    themeObserver.observe(shell, {
      attributes: true,
      attributeFilter: ["data-dark-theme", "data-light-theme"],
    });

    return () => {
      loadVersion += 1;
      renderVersion += 1;
      themeObserver?.disconnect();
    };
  });

  $effect(() => {
    void loadFile();
  });

  $effect(() => {
    void [file?.content, file?.path, activeLineNumber];
    void renderCode();
  });
</script>

<section class="file-viewer-panel">
  {#if errorMessage}
    <div class="file-viewer-state error">
      {errorMessage}
    </div>
  {:else if loading && !file}
    <div class="file-viewer-state">
      Loading file...
    </div>
  {:else}
    <FileViewerToolbar
      {filePath}
      {activeDiffEntry}
      {isEditing}
      {isDirty}
      {isSaving}
      {canEdit}
      {viewMode}
      onEnterEdit={enterEditMode}
      onSave={saveFile}
      onCancelEdit={attemptExitEditMode}
      onSetViewMode={(mode) => (viewMode = mode)}
      onClose={onClose}
    />

    {#if saveError}
      <div class="file-viewer-state error">
        {saveError}
      </div>
    {/if}

    {#if file?.truncated}
      <div class="file-viewer-notice">
        Showing the first {file.lineCount} lines. The full file is
        {file.totalBytes} bytes. Editing is disabled for truncated files.
      </div>
    {/if}

    {#if viewMode === "diff" && activeDiffEntry}
      <FileViewerDiffContent entry={activeDiffEntry} />
    {:else if isEditing}
      <FileViewerEditor bind:value={editedContent} bind:textarea onKeydown={onEditorKeydown} />
    {:else}
      <FileViewerCodeContent bind:container {renderedHtml} />
    {/if}
  {/if}
</section>

{#if pendingDiscard}
  <FileViewerDiscardConfirm onCancel={cancelDiscard} onConfirm={confirmDiscard} />
{/if}

<style>
  .file-viewer-panel {
    --file-viewer-code-bg: var(--bg);

    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    background: var(--rail-bg);
    position: relative;
  }

  .file-viewer-state,
  .file-viewer-notice {
    margin: 10px 14px 0;
    padding: 10px 12px;
    border-radius: 12px;
    font-size: 0.74rem;
    line-height: 1.5;
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

  @media (max-width: 900px) {
    .file-viewer-state,
    .file-viewer-notice {
      margin-inline: 12px;
    }
  }
</style>