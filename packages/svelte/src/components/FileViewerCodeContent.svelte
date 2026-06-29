<script lang="ts">
  let {
    container = $bindable<HTMLDivElement | null>(),
    renderedHtml,
  }: {
    container?: HTMLDivElement | null;
    renderedHtml: string;
  } = $props();
</script>

<div bind:this={container} class="file-viewer-code-shell">
  {#if renderedHtml}
    <div class="file-viewer-code">{@html renderedHtml}</div>
  {:else}
    <div class="file-viewer-empty">This file is empty.</div>
  {/if}
</div>

<style>
  .file-viewer-code-shell {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-top: 1px solid var(--border);
    background: var(--file-viewer-code-bg);
    scrollbar-width: none;
  }

  .file-viewer-code-shell::-webkit-scrollbar {
    display: none;
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

  .file-viewer-empty {
    margin: 10px 14px 0;
    padding: 10px 12px;
    border-radius: 12px;
    font-size: 0.74rem;
    line-height: 1.5;
  }

  @media (max-width: 900px) {
    .file-viewer-empty {
      margin-inline: 12px;
    }
  }
</style>