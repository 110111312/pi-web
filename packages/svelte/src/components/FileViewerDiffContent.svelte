<script lang="ts">
  import type { RpcDiffEntry } from "@pi-web/bridge/types";

  let {
    entry,
  }: {
    entry: RpcDiffEntry;
  } = $props();
</script>

<div class="file-viewer-diff-shell">
  {#if entry.hunks.length === 0}
    <div class="file-viewer-empty">
      No textual diff (binary file, or all changes are whitespace).
    </div>
  {:else}
    <div class="file-viewer-diff">
      {#each entry.hunks as hunk, hi (hi)}
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

<style>
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

  .file-viewer-empty {
    margin: 10px 14px 0;
    padding: 10px 12px;
    border-radius: 12px;
    font-size: 0.74rem;
    line-height: 1.5;
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

  @media (max-width: 900px) {
    .file-viewer-empty {
      margin-inline: 12px;
    }
  }
</style>