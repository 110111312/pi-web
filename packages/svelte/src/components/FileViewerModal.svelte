<script lang="ts">
  import type { RpcWorkspaceFile } from "@pi-web/bridge/types";
  import FileViewerPanel from "./FileViewerPanel.svelte";

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
    onClose = () => {},
  }: {
    filePath: string;
    lineNumber: number;
    readWorkspaceFile: (path: string) => Promise<RpcWorkspaceFile>;
    writeWorkspaceFile?: (
      path: string,
      content: string,
    ) => Promise<WriteResult>;
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
    <FileViewerPanel
      {filePath}
      {lineNumber}
      {readWorkspaceFile}
      {writeWorkspaceFile}
      {onClose}
    />
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
    padding: max(4vh, env(safe-area-inset-top, 0px)) max(4vw, env(safe-area-inset-right, 0px)) max(4vh, env(safe-area-inset-bottom, 0px)) max(4vw, env(safe-area-inset-left, 0px));
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
    height: min(92dvh, 1000px);
    max-width: 92vw;
    max-height: 92dvh;
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

  .file-viewer-modal :global(.file-viewer-panel) {
    height: 100%;
  }

  @media (max-width: 900px) {
    .file-viewer-modal-backdrop {
      padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
    }

    .file-viewer-modal {
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      border-radius: 0;
      border: none;
    }
  }
</style>