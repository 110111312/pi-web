<script lang="ts">
  import { onMount } from "svelte";
  import {
    buildFallbackLines,
    diffOptions,
    type DiffEdit,
    type DiffsModule,
    type FileDiffRenderer,
    looksLikeNumberedEditDiff,
    looksLikePatch,
    parseDiffText,
    type ReadWorkspaceFile,
    synthesizePatchFromEdits,
  } from "../utils/diffView";

  let {
    diff = "",
    path,
    edits = [],
    readWorkspaceFile,
  }: {
    diff?: string;
    path?: string;
    edits?: DiffEdit[];
    readWorkspaceFile?: ReadWorkspaceFile;
  } = $props();

  let host = $state<HTMLElement | null>(null);
  let hasRenderedDiff = $state(false);
  let renderError = $state("");
  let loading = $state(false);
  let currentFileContent = $state<string | null>(null);
  let currentFilePath = $state<string | null>(null);
  let diffRenderer: FileDiffRenderer | undefined;
  let themeObserver: MutationObserver | undefined;
  let currentFileRequestId = 0;
  let renderRequestId = 0;

  let diffsModulePromise: Promise<DiffsModule> | undefined;

  function loadDiffsModule() {
    diffsModulePromise ??= import("@pierre/diffs");
    return diffsModulePromise;
  }

  let normalizedDiff = $derived(diff.replace(/\r/g, "").trim());
  let syntheticPatch = $derived(
    synthesizePatchFromEdits(edits, currentFileContent, path),
  );
  let fallbackText = $derived(
    looksLikePatch(normalizedDiff) || looksLikeNumberedEditDiff(normalizedDiff)
      ? normalizedDiff
      : syntheticPatch || normalizedDiff,
  );
  let fallbackLines = $derived(buildFallbackLines(fallbackText));

  function clearRenderedDiff() {
    diffRenderer?.cleanUp();
    diffRenderer = undefined;
    hasRenderedDiff = false;
  }

  function createDiffRenderer(
    FileDiff: DiffsModule["FileDiff"],
    registerCustomTheme: DiffsModule["registerCustomTheme"],
  ) {
    clearRenderedDiff();
    diffRenderer = new FileDiff(diffOptions(registerCustomTheme), undefined, true);
    return diffRenderer;
  }

  async function renderDiff() {
    if (!host) return;

    const requestId = ++renderRequestId;

    if (!fallbackText) {
      clearRenderedDiff();
      renderError = "";
      loading = false;
      return;
    }

    loading = true;

    try {
      const diffs = await loadDiffsModule();
      if (requestId !== renderRequestId || !host) return;

      const fileDiff = parseDiffText(
        normalizedDiff,
        diffs.processFile,
        path,
        syntheticPatch,
      );
      const renderer = createDiffRenderer(diffs.FileDiff, diffs.registerCustomTheme);
      if (requestId !== renderRequestId || !host) return;

      renderer.render({
        fileDiff,
        fileContainer: host,
        forceRender: true,
      });
      hasRenderedDiff = true;
      renderError = "";
    } catch (error) {
      clearRenderedDiff();
      renderError =
        error instanceof Error ? error.message : "Failed to render diff";
    } finally {
      if (requestId === renderRequestId) loading = false;
    }
  }

  $effect(() => {
    void [path, readWorkspaceFile];

    const currentPath = path;
    if (!currentPath || edits.length === 0 || !readWorkspaceFile) {
      currentFileContent = null;
      currentFilePath = null;
      return;
    }
    if (currentFilePath === currentPath && currentFileContent !== null) {
      return;
    }

    const requestId = ++currentFileRequestId;
    currentFilePath = currentPath;
    currentFileContent = null;
    readWorkspaceFile(currentPath)
      .then(file => {
        if (requestId === currentFileRequestId && currentFilePath === currentPath) {
          currentFileContent = file.content;
        }
      })
      .catch(() => {
        if (requestId === currentFileRequestId && currentFilePath === currentPath) {
          currentFileContent = null;
        }
      });

    return () => {
      currentFileRequestId += 1;
    };
  });

  $effect(() => {
    void [host, normalizedDiff, path, syntheticPatch];
    renderDiff();
  });

  onMount(() => {
    const shell = document.querySelector(".app-shell");
    if (shell) {
      themeObserver = new MutationObserver(() => {
        void renderDiff();
      });
      themeObserver.observe(shell, {
        attributes: true,
        attributeFilter: [
          "data-theme-mode",
          "data-theme",
          "data-dark-theme",
          "data-light-theme",
        ],
      });
    }

    return () => {
      themeObserver?.disconnect();
      renderRequestId += 1;
      clearRenderedDiff();
    };
  });
</script>

<div class="diff-view-shell">
  <diffs-container bind:this={host} class="diff-view-host"></diffs-container>

  {#if loading && !hasRenderedDiff && !renderError}
    <div class="diff-view-status">Loading diff...</div>
  {:else if !hasRenderedDiff && fallbackText}
    <div class="diff-view-fallback" role="note">
      {#if renderError}
        <div class="diff-view-fallback-title">{renderError}</div>
      {/if}
      <table class="diff-table" role="presentation">
        <tbody>
          {#each fallbackLines as line, index (`${index}:${line.text}`)}
            <tr class="diff-line" data-kind={line.kind}>
              <td>
                <pre>{line.text}</pre>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .diff-view-shell {
    margin: 0;
    border: 1px solid var(--tool-output-border);
    border-radius: 10px;
    background: var(--tool-output-bg);
    overflow: auto;
    max-height: 360px;
  }

  .diff-view-host {
    display: block;
    min-width: 0;
  }

  .diff-view-status,
  .diff-view-fallback {
    color: var(--text-muted);
  }

  .diff-view-status,
  .diff-view-fallback-title {
    padding: 10px 12px;
    font-size: 0.72rem;
    line-height: 1.65;
  }

  .diff-view-fallback-title {
    color: var(--warning-text, var(--text));
  }

  .diff-table {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
    border-spacing: 0;
  }

  .diff-line td {
    padding: 0;
    color: var(--text);
  }

  .diff-line pre {
    margin: 0;
    padding: 0 12px;
    font-family: var(--pi-font-mono);
    font-size: 0.72rem;
    line-height: 1.65;
    white-space: pre;
    color: inherit;
    font-weight: 500;
  }

  .diff-line[data-kind="header"] td {
    background: color-mix(in srgb, var(--tool-output-bg) 92%, var(--border));
    color: var(--text-subtle);
  }

  .diff-line[data-kind="hunk"] td {
    border-top: 1px solid
      color-mix(in srgb, var(--tool-output-border) 82%, transparent);
    border-bottom: 1px solid
      color-mix(in srgb, var(--tool-output-border) 82%, transparent);
    background: color-mix(in srgb, var(--tool-output-bg) 84%, var(--border));
    color: var(--text);
  }

  .diff-line[data-kind="added"] td {
    background: color-mix(
      in srgb,
      var(--diff-added-bg) 72%,
      var(--tool-output-bg)
    );
    box-shadow: inset 3px 0 0 var(--diff-added-accent);
    color: var(--diff-added-text);
  }

  .diff-line[data-kind="removed"] td {
    background: color-mix(
      in srgb,
      var(--diff-removed-bg) 72%,
      var(--tool-output-bg)
    );
    box-shadow: inset 3px 0 0 var(--diff-removed-accent);
    color: var(--diff-removed-text);
  }
</style>