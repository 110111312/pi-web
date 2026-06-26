<script lang="ts">
  import type { RpcDiffEntry, RpcWorkspaceFile } from "@pi-web/bridge/types";
  import { onMount, tick } from "svelte";
  import FileText from "lucide-svelte/icons/file-text";
  import GitCompare from "lucide-svelte/icons/git-compare";
  import Pencil from "lucide-svelte/icons/pencil";
  import Save from "lucide-svelte/icons/save";
  import X from "lucide-svelte/icons/x";
  import { highlightCodeLinesHtml } from "../utils/codeHighlight";

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
    <header class="file-viewer-header">
      <div class="file-viewer-header-meta">
        <span
          class="file-viewer-path"
          title={activeDiffEntry?.path ?? file?.path ?? filePath}
        >
          {activeDiffEntry?.path ?? file?.path ?? filePath}
        </span>
        {#if activeDiffEntry}
          <span
            class={`status-badge status-${activeDiffEntry.status}`}
            aria-hidden="true"
          >
            {activeDiffEntry.status === "added"
              ? "A"
              : activeDiffEntry.status === "deleted"
                ? "D"
                : activeDiffEntry.status === "renamed"
                  ? "R"
                  : "M"}
          </span>
        {/if}
        {#if isDirty}
          <span class="file-viewer-dirty" aria-label="Unsaved changes">●</span>
        {/if}
      </div>
      {#if activeDiffEntry && !isEditing}
        <div class="file-viewer-mode-toggle">
          <button
            type="button"
            class="file-viewer-mode-btn"
            class:active={viewMode === "diff"}
            onclick={() => (viewMode = "diff")}
            title="View diff"
            aria-pressed={viewMode === "diff"}
          >
            <GitCompare size={13} aria-hidden="true" />
            <span>Diff</span>
          </button>
          <button
            type="button"
            class="file-viewer-mode-btn"
            class:active={viewMode === "file"}
            onclick={() => (viewMode = "file")}
            title="View file"
            aria-pressed={viewMode === "file"}
          >
            <FileText size={13} aria-hidden="true" />
            <span>File</span>
          </button>
        </div>
      {/if}
      {#if canEdit && !isEditing && (!activeDiffEntry || viewMode === "file")}
        <button
          type="button"
          class="file-viewer-edit-btn"
          onclick={enterEditMode}
          title="Edit file"
          aria-label="Edit file"
        >
          <Pencil size={13} aria-hidden="true" />
          <span>Edit</span>
        </button>
      {/if}
      {#if isEditing}
        <div class="file-viewer-edit-actions">
          <button
            type="button"
            class="file-viewer-save-btn"
            onclick={saveFile}
            disabled={!isDirty || isSaving}
            title="Save (Ctrl+S)"
          >
            <Save size={13} aria-hidden="true" />
            <span>{isSaving ? "Saving…" : "Save"}</span>
          </button>
          <button
            type="button"
            class="file-viewer-cancel-btn"
            onclick={attemptExitEditMode}
            disabled={isSaving}
            title="Cancel editing (Esc)"
          >
            <X size={13} aria-hidden="true" />
            <span>Cancel</span>
          </button>
        </div>
      {/if}
      <button
        type="button"
        class="file-viewer-close-btn"
        onclick={() => onClose()}
        title="Close (Esc)"
        aria-label="Close file viewer"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </header>

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
      <div class="file-viewer-diff-shell">
        {#if activeDiffEntry.hunks.length === 0}
          <div class="file-viewer-empty">
            No textual diff (binary file, or all changes are whitespace).
          </div>
        {:else}
          <div class="file-viewer-diff">
            {#each activeDiffEntry.hunks as hunk, hi (hi)}
              <div class="diff-hunk-header">
                @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
              </div>
              {#each hunk.lines as line, li (li)}
                <div class={`diff-line diff-line-${line.type}`}>
                  <span class="diff-line-old-no" aria-hidden="true">
                    {line.oldLineNo ?? ""}
                  </span>
                  <span class="diff-line-new-no" aria-hidden="true">
                    {line.newLineNo ?? ""}
                  </span>
                  <span class="diff-line-marker" aria-hidden="true">
                    {line.type === "added"
                      ? "+"
                      : line.type === "deleted"
                        ? "−"
                        : " "}
                  </span>
                  <span class="diff-line-content"
                    >{line.content || "\u00A0"}</span
                  >
                </div>
              {/each}
            {/each}
          </div>
        {/if}
      </div>
    {:else if isEditing}
      <div class="file-viewer-editor-shell">
        <textarea
          bind:this={textarea}
          class="file-viewer-editor"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          value={editedContent}
          oninput={(e) => {
            editedContent = (e.currentTarget as HTMLTextAreaElement).value;
          }}
          onkeydown={onEditorKeydown}
        ></textarea>
      </div>
    {:else}
      <div bind:this={container} class="file-viewer-code-shell">
        {#if renderedHtml}
          <div class="file-viewer-code">{@html renderedHtml}</div>
        {:else}
          <div class="file-viewer-empty">This file is empty.</div>
        {/if}
      </div>
    {/if}
  {/if}
</section>

{#if pendingDiscard}
  <div
    class="file-viewer-confirm-backdrop"
    role="button"
    tabindex="-1"
    onclick={cancelDiscard}
    onkeydown={(e) => e.key === "Escape" && cancelDiscard()}
  ></div>
  <div class="file-viewer-confirm" role="dialog" aria-modal="true">
    <div class="file-viewer-confirm-title">Discard unsaved changes?</div>
    <div class="file-viewer-confirm-body">
      You have unsaved edits that will be lost.
    </div>
    <div class="file-viewer-confirm-actions">
      <button type="button" onclick={cancelDiscard}>Keep editing</button>
      <button type="button" class="danger" onclick={confirmDiscard}>
        Discard
      </button>
    </div>
  </div>
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

  .file-viewer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 38px;
    padding: 6px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
    background: color-mix(in srgb, var(--panel) 50%, transparent);
  }

  .file-viewer-header-meta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }

  .file-viewer-path {
    font-family: var(--pi-font-mono);
    font-size: 0.7rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl; /* keep file name visible when truncating */
    text-align: left;
  }

  .file-viewer-dirty {
    color: var(--warning);
    font-size: 0.9rem;
    line-height: 1;
  }

  .file-viewer-edit-btn,
  .file-viewer-save-btn,
  .file-viewer-cancel-btn,
  .file-viewer-mode-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--panel-2) 60%, transparent);
    color: var(--text);
    font: inherit;
    font-size: 0.74rem;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }

  .file-viewer-edit-btn:hover,
  .file-viewer-save-btn:hover:not(:disabled),
  .file-viewer-cancel-btn:hover:not(:disabled),
  .file-viewer-mode-btn:hover {
    background: color-mix(in srgb, var(--surface-active) 38%, var(--panel-2));
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  }

  .file-viewer-mode-btn.active {
    background: color-mix(in srgb, var(--accent) 18%, var(--panel-2));
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    color: var(--text);
  }

  .file-viewer-save-btn:disabled,
  .file-viewer-cancel-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .file-viewer-edit-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .file-viewer-mode-toggle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--panel-2) 40%, transparent);
  }

  .file-viewer-mode-btn {
    height: 28px;
    padding: 0 8px;
    border: 1px solid transparent;
    background: transparent;
    border-radius: 6px;
  }

  .file-viewer-mode-btn.active {
    background: color-mix(in srgb, var(--accent) 18%, var(--panel-2));
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  }

  .file-viewer-close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--panel-2) 60%, transparent);
    color: var(--text);
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }

  .file-viewer-close-btn:hover {
    background: color-mix(in srgb, var(--surface-active) 38%, var(--panel-2));
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
    color: var(--text);
  }

  .file-viewer-close-btn:focus-visible {
    outline: none;
    border-color: var(--accent);
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

  .file-viewer-code-shell,
  .file-viewer-editor-shell {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-top: 1px solid var(--border);
    background: var(--file-viewer-code-bg);
    scrollbar-width: none;
  }

  .file-viewer-code-shell::-webkit-scrollbar,
  .file-viewer-editor-shell::-webkit-scrollbar {
    display: none;
  }

  .file-viewer-editor {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 100%;
    padding: 8px 14px;
    border: none;
    outline: none;
    resize: none;
    background: var(--file-viewer-code-bg);
    color: var(--text);
    font-family: var(--pi-font-mono);
    font-size: 0.72rem;
    line-height: 1.35;
    white-space: pre;
    tab-size: 2;
    box-sizing: border-box;
  }

  .file-viewer-code {
    min-width: max-content;
    min-height: 100%;
    padding-bottom: 4px;
    background: var(--file-viewer-code-bg);
  }

  .file-viewer-code :global(pre) {
    min-height: 100%;
    margin: 0;
    padding: 2px 0 6px;
    overflow: visible;
    background: transparent !important;
  }

  .file-viewer-code :global(code) {
    display: block;
    min-width: max-content;
    min-height: 100%;
    font-family: var(--pi-font-mono);
    font-size: 0.72rem;
    line-height: 1.35;
    white-space: normal;
  }

  .file-viewer-code :global(.code-line) {
    display: block;
    position: relative;
    padding: 0 14px 0 62px;
    white-space: pre;
    line-height: 1.35;
    background: transparent;
  }

  .file-viewer-code :global(.code-line:empty)::after {
    content: " ";
    visibility: hidden;
  }

  .file-viewer-code :global(.code-line)::before {
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

  .file-viewer-code :global(.code-line-target) {
    background: var(--surface-active);
  }

  .file-viewer-code :global(.code-line-target)::before {
    color: var(--accent-hover);
    background: var(--surface-active);
  }

  /* Diff view */
  .file-viewer-diff-shell {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-top: 1px solid var(--border);
    background: var(--file-viewer-code-bg);
    scrollbar-width: thin;
  }

  .file-viewer-diff {
    min-width: max-content;
    min-height: 100%;
    padding-bottom: 4px;
  }

  .diff-hunk-header {
    padding: 4px 14px;
    font-family: var(--pi-font-mono);
    font-size: 0.7rem;
    color: var(--text-subtle);
    background: color-mix(in srgb, var(--panel) 50%, transparent);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    user-select: none;
  }

  .diff-line {
    display: grid;
    grid-template-columns: 52px 52px 24px 1fr;
    align-items: stretch;
    line-height: 1.45;
    font-family: var(--pi-font-mono);
    font-size: 0.72rem;
    white-space: pre;
  }

  .diff-line-added {
    background: rgba(46, 160, 67, 0.15);
    border-left: 3px solid rgba(46, 160, 67, 0.6);
  }

  .diff-line-deleted {
    background: rgba(248, 81, 73, 0.15);
    border-left: 3px solid rgba(248, 81, 73, 0.6);
  }

  .diff-line-context {
    border-left: 3px solid transparent;
  }

  .diff-line-old-no,
  .diff-line-new-no {
    padding: 0 8px;
    text-align: right;
    color: var(--text-subtle);
    user-select: none;
    border-right: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .diff-line-marker {
    text-align: center;
    user-select: none;
    color: var(--text-subtle);
  }

  .diff-line-content {
    padding-right: 14px;
    overflow: visible;
  }

  .diff-line-added .diff-line-marker {
    color: rgba(46, 160, 67, 0.9);
  }

  .diff-line-added .diff-line-old-no,
  .diff-line-added .diff-line-new-no {
    color: rgba(86, 211, 100, 0.6);
  }

  .diff-line-deleted .diff-line-marker {
    color: rgba(248, 81, 73, 0.9);
  }

  .diff-line-deleted .diff-line-old-no,
  .diff-line-deleted .diff-line-new-no {
    color: rgba(255, 123, 114, 0.6);
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border-radius: 4px;
    font-family: var(--pi-font-mono);
    font-size: 0.66rem;
    font-weight: 700;
    line-height: 1;
  }

  .status-modified {
    background: color-mix(in srgb, #1f6feb 24%, transparent);
    color: #79b8ff;
    border: 1px solid color-mix(in srgb, #1f6feb 50%, transparent);
  }

  .status-added {
    background: color-mix(in srgb, #2ea043 24%, transparent);
    color: #56d364;
    border: 1px solid color-mix(in srgb, #2ea043 50%, transparent);
  }

  .status-deleted {
    background: color-mix(in srgb, #da3633 24%, transparent);
    color: #ff7b72;
    border: 1px solid color-mix(in srgb, #da3633 50%, transparent);
  }

  .status-renamed {
    background: color-mix(in srgb, #8957e5 24%, transparent);
    color: #d2a8ff;
    border: 1px solid color-mix(in srgb, #8957e5 50%, transparent);
  }

  .file-viewer-confirm-backdrop {
    position: absolute;
    inset: 0;
    background: var(--backdrop);
    z-index: 20;
  }

  .file-viewer-confirm {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 21;
    min-width: 260px;
    max-width: 320px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    box-shadow: var(--shadow);
    color: var(--text);
  }

  .file-viewer-confirm-title {
    font-size: 0.82rem;
    font-weight: 600;
    margin-bottom: 6px;
  }

  .file-viewer-confirm-body {
    font-size: 0.74rem;
    color: var(--text-muted);
    margin-bottom: 12px;
    line-height: 1.4;
  }

  .file-viewer-confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .file-viewer-confirm-actions button {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--panel-2) 60%, transparent);
    color: var(--text);
    font: inherit;
    font-size: 0.74rem;
    cursor: pointer;
  }

  .file-viewer-confirm-actions button.danger {
    border-color: color-mix(in srgb, var(--danger) 50%, var(--border));
    background: color-mix(in srgb, var(--danger) 18%, var(--panel-2));
    color: var(--error-text);
  }

  @media (max-width: 900px) {
    .file-viewer-state,
    .file-viewer-notice,
    .file-viewer-empty {
      margin-inline: 12px;
    }
  }
</style>