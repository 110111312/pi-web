<script lang="ts">
  import X from "lucide-svelte/icons/x";
  import { formatAttachmentSize } from "../utils/attachments";
  import { createComposerBarState } from "./composerBarState.svelte";

  type ComposerBarStateLike = ReturnType<typeof createComposerBarState>;

  let {
    composer,
  }: {
    composer: ComposerBarStateLike;
  } = $props();
</script>

{#if composer.attachments.length > 0}
  <div class="attachment-strip">
    {#each composer.attachments as attachment, index (attachment.id)}
      <div class="attachment-chip">
        <button
          type="button"
          class="attachment-chip-open"
          aria-label={`View ${attachment.name}`}
          onclick={() => composer.openAttachmentLightbox(index)}
        >
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
        </button>
        <button
          type="button"
          class="attachment-chip-remove"
          aria-label={`Remove ${attachment.name}`}
          onclick={() => composer.removeAttachment(attachment.id)}
        >
          <X class="attachment-chip-remove-icon" aria-hidden="true" size={14} />
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
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

  .attachment-chip-open {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    cursor: zoom-in;
    text-align: left;
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
  .attachment-summary {
    font-family: var(--pi-font-mono);
  }

  .attachment-chip-name {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.72rem;
    color: var(--text);
  }

  .attachment-chip-meta {
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

  .attachment-chip-open:hover .attachment-chip-name,
  .attachment-chip-open:focus-visible .attachment-chip-name,
  .attachment-chip-remove:hover {
    color: var(--text);
  }

  .attachment-chip-open:hover .attachment-chip-preview,
  .attachment-chip-open:focus-visible .attachment-chip-preview,
  .attachment-chip-remove:hover {
    background: var(--bg);
  }

  .attachment-chip-open:focus-visible,
  .attachment-chip-remove:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 54%, white 12%);
    outline-offset: 2px;
  }

  @media (max-width: 640px) {
    .attachment-chip {
      min-width: 200px;
    }
  }
</style>