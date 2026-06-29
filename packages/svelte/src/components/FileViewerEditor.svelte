<script lang="ts">
  let {
    value = $bindable(""),
    textarea = $bindable<HTMLTextAreaElement | null>(),
    onKeydown,
  }: {
    value: string;
    textarea?: HTMLTextAreaElement | null;
    onKeydown?: (event: KeyboardEvent) => void;
  } = $props();
</script>

<div class="file-viewer-editor-shell">
  <textarea
    bind:this={textarea}
    class="file-viewer-editor"
    spellcheck="false"
    autocomplete="off"
    autocapitalize="off"
    autocorrect="off"
    {value}
    oninput={(e) => {
      value = (e.currentTarget as HTMLTextAreaElement).value;
    }}
    onkeydown={onKeydown}
  ></textarea>
</div>

<style>
  .file-viewer-editor-shell {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-top: 1px solid var(--border);
    background: var(--file-viewer-code-bg);
    scrollbar-width: none;
  }

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
</style>