<script lang="ts">
  import type { RpcDiffEntry } from "@pi-web/bridge/types";
  import FileText from "lucide-svelte/icons/file-text";
  import GitCompare from "lucide-svelte/icons/git-compare";
  import Pencil from "lucide-svelte/icons/pencil";
  import Save from "lucide-svelte/icons/save";
  import X from "lucide-svelte/icons/x";

  let {
    filePath,
    activeDiffEntry,
    isEditing,
    isDirty,
    isSaving,
    canEdit,
    viewMode,
    onEnterEdit,
    onSave,
    onCancelEdit,
    onSetViewMode,
    onClose,
  }: {
    filePath: string;
    activeDiffEntry: RpcDiffEntry | null;
    isEditing: boolean;
    isDirty: boolean;
    isSaving: boolean;
    canEdit: boolean;
    viewMode: "diff" | "file";
    onEnterEdit: () => void;
    onSave: () => void;
    onCancelEdit: () => void;
    onSetViewMode: (mode: "diff" | "file") => void;
    onClose: () => void;
  } = $props();
</script>

<header class="file-viewer-header">
  <div class="file-viewer-header-meta">
    <span
      class="file-viewer-path"
      title={activeDiffEntry?.path ?? filePath}
    >
      {activeDiffEntry?.path ?? filePath}
    </span>
    {#if activeDiffEntry}
      <span
        class={`status-badge status-${activeDiffEntry.status}`}
        aria-hidden="true"
      >
        {activeDiffEntry.status === "added"
          ? "A"
          : activeDiffEntry.status === "untracked"
            ? "U"
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
        onclick={() => onSetViewMode("diff")}
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
        onclick={() => onSetViewMode("file")}
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
      onclick={onEnterEdit}
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
        onclick={onSave}
        disabled={!isDirty || isSaving}
        title="Save (Ctrl+S)"
      >
        <Save size={13} aria-hidden="true" />
        <span>{isSaving ? "Saving…" : "Save"}</span>
      </button>
      <button
        type="button"
        class="file-viewer-cancel-btn"
        onclick={onCancelEdit}
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
    onclick={onClose}
    title="Close (Esc)"
    aria-label="Close file viewer"
  >
    <X size={14} aria-hidden="true" />
  </button>
</header>

<style>
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

  .status-untracked {
    background: color-mix(in srgb, #d29922 24%, transparent);
    color: #e3b341;
    border: 1px solid color-mix(in srgb, #d29922 50%, transparent);
  }
</style>