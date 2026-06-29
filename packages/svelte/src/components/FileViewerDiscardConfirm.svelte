<script lang="ts">
  let {
    onCancel,
    onConfirm,
  }: {
    onCancel: () => void;
    onConfirm: () => void;
  } = $props();
</script>

<div
  class="file-viewer-confirm-backdrop"
  role="button"
  tabindex="-1"
  onclick={onCancel}
  onkeydown={(e) => e.key === "Escape" && onCancel()}
></div>
<div class="file-viewer-confirm" role="dialog" aria-modal="true">
  <div class="file-viewer-confirm-title">Discard unsaved changes?</div>
  <div class="file-viewer-confirm-body">
    You have unsaved edits that will be lost.
  </div>
  <div class="file-viewer-confirm-actions">
    <button type="button" onclick={onCancel}>Keep editing</button>
    <button type="button" class="danger" onclick={onConfirm}>
      Discard
    </button>
  </div>
</div>

<style>
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
</style>