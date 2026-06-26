<script lang="ts">
  import type { RpcWorkspaceFile } from "@pi-web/bridge/types";
  import FileViewerPanel from "./FileViewerPanel.svelte";
  import X from "lucide-svelte/icons/x";

  type WriteResult = {
    path: string;
    absolutePath: string;
    mtime: string;
    bytesWritten: number;
  };

  let {
    filePath = "",
    lineNumber = 1,
    readWorkspaceFile = (_: string) =>
      Promise.resolve({} as RpcWorkspaceFile),
    writeWorkspaceFile = (_: string, __: string, ___?: string) =>
      Promise.resolve({
        path: "",
        absolutePath: "",
        mtime: "",
        bytesWritten: 0,
      } satisfies WriteResult),
    editable = true,
    onClose = () => {},
  }: {
    filePath: string;
    lineNumber: number;
    readWorkspaceFile: (path: string) => Promise<RpcWorkspaceFile>;
    writeWorkspaceFile?: (
      path: string,
      content: string,
      expectedMtime?: string,
    ) => Promise<WriteResult>;
    editable?: boolean;
    onClose: () => void;
  } = $props();

  let modalElement = $state<HTMLDivElement | null>(null);
  let previousActiveElement: HTMLElement | null = null;

  function handleBackdropClick(event: MouseEvent) {
    // Only close when the click originates on the backdrop itself, not on
    // the modal content (which is a child of the backdrop).
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  $effect(() => {
    // Remember which element had focus before the modal opened so we can
    // restore it when the modal closes.
    if (typeof document === "undefined") return;
    previousActiveElement = document.activeElement as HTMLElement | null;

    // Prevent background scrolling while the modal is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the modal.
    queueMicrotask(() => {
      modalElement?.focus();
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus?.();
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="file-viewer-modal-backdrop"
  role="presentation"
  onclick={handleBackdropClick}
>
  <div
    bind:this={modalElement}
    class="file-viewer-modal"
    role="dialog"
    aria-modal="true"
    aria-label="File viewer"
    tabindex="-1"
  >
    <header class="file-viewer-modal-header">
      <div class="file-viewer-modal-title" title={filePath}>
        {filePath}
      </div>
      <button
        type="button"
        class="file-viewer-modal-close"
        aria-label="Close file viewer"
        title="Close (Esc)"
        onclick={onClose}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </header>
    <div class="file-viewer-modal-body">
      <FileViewerPanel
        {filePath}
        {lineNumber}
        {readWorkspaceFile}
        {writeWorkspaceFile}
        {editable}
      />
    </div>
  </div>
</div>

<style>
  .file-viewer-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4vh 4vw;
    background: var(--backdrop);
    animation: file-viewer-modal-fade-in 0.14s ease;
  }

  @keyframes file-viewer-modal-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .file-viewer-modal {
    display: flex;
    flex-direction: column;
    width: min(92vw, 1400px);
    height: min(92vh, 1000px);
    max-width: 92vw;
    max-height: 92vh;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--rail-bg);
    box-shadow: var(--shadow);
    overflow: hidden;
    outline: none;
    animation: file-viewer-modal-zoom-in 0.14s ease;
  }

  @keyframes file-viewer-modal-zoom-in {
    from {
      transform: scale(0.97);
    }
    to {
      transform: scale(1);
    }
  }

  .file-viewer-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 44px;
    padding: 6px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
    background: color-mix(in srgb, var(--panel) 50%, transparent);
    flex-shrink: 0;
  }

  .file-viewer-modal-title {
    font-family: var(--pi-font-mono);
    font-size: 0.78rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl; /* keep file name visible when truncating */
    text-align: left;
    flex: 1;
    min-width: 0;
  }

  .file-viewer-modal-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
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

  .file-viewer-modal-close:hover {
    background: color-mix(in srgb, var(--surface-active) 38%, var(--panel-2));
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
    color: var(--text);
  }

  .file-viewer-modal-close:focus-visible {
    outline: none;
    border-color: var(--accent);
  }

  .file-viewer-modal-body {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .file-viewer-modal-body :global(.file-viewer-panel) {
    height: 100%;
  }

  @media (max-width: 900px) {
    .file-viewer-modal-backdrop {
      padding: 0;
    }

    .file-viewer-modal {
      width: 100vw;
      height: 100vh;
      max-width: 100vw;
      max-height: 100vh;
      border-radius: 0;
      border: none;
    }
  }
</style>