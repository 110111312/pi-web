<script lang="ts">
  type Revision = {
    entryId: string;
    text: string;
    preview: string;
    hasImages: boolean;
    images: import("@pi-web/bridge/types").RpcImageContent[];
  };

  let {
    revision = null as Revision | null,
    onCancel = () => {},
  } = $props();
</script>

{#if revision}
  <div class="revision-banner">
    <div class="revision-banner-copy">
      <p class="revision-preview">{revision.preview}</p>
    </div>
    <button
      type="button"
      class="revision-cancel-button"
      onclick={onCancel}
    >
      Cancel
    </button>
  </div>
{/if}

<style>
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

  .revision-banner-copy {
    min-width: 0;
  }

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

  @media (max-width: 640px) {
    .revision-banner {
      flex-direction: column;
    }

    .revision-cancel-button {
      align-self: flex-start;
    }
  }
</style>