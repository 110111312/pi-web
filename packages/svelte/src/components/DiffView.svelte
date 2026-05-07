<script lang="ts">
  import { processFile, registerCustomTheme } from "@pierre/diffs";
  import { preloadFileDiff } from "@pierre/diffs/ssr";
  import { onMount } from "svelte";
  import {
    readThemeModeFromDom,
    readThemePairFromDom,
    resolveShikiTheme,
  } from "../themes";

  type DiffEdit = { oldText: string; newText: string };

  const REGISTERED_DIFF_THEMES = new Set<string>();

  let {
    diff = "",
    path,
    edits = [],
  }: {
    diff?: string;
    path?: string;
    edits?: DiffEdit[];
  } = $props();

  let host = $state<HTMLDivElement | null>(null);
  let renderedHtml = $state("");
  let renderError = $state("");
  let loading = $state(false);
  let renderVersion = 0;
  let themeObserver: MutationObserver | undefined;

  let normalizedDiff = $derived(diff.replace(/\r/g, "").trim());
  let syntheticPatch = $derived(synthesizePatchFromEdits(edits));
  let fallbackText = $derived(
    looksLikePatch(normalizedDiff) ? normalizedDiff : syntheticPatch || normalizedDiff,
  );
  let fallbackLines = $derived(
    fallbackText.split("\n").map(line => ({
      text: line,
      kind: classifyLine(line),
    })),
  );

  function themedUnsafeCss() {
    return `
      :host {
        --diffs-bg: var(--tool-output-bg);
        --diffs-fg: var(--text);
        --diffs-fg-number-override: var(--text-subtle);
        --diffs-fg-conflict-marker-override: var(--text-subtle);
        --diffs-bg-context-override: color-mix(in srgb, var(--tool-output-bg) 92%, var(--panel));
        --diffs-bg-separator-override: var(--diff-header-bg);
        --diffs-font-family: var(--pi-font-mono);
        --diffs-header-font-family: var(--pi-font-sans);
        --diffs-font-size: 0.72rem;
        --diffs-line-height: 1.65;
        --diffs-addition-color-override: var(--diff-added-accent);
        --diffs-deletion-color-override: var(--diff-removed-accent);
        --diffs-modified-color-override: var(--accent);
        --diffs-bg-addition-override: color-mix(in srgb, var(--diff-added-bg) 78%, var(--tool-output-bg));
        --diffs-bg-deletion-override: color-mix(in srgb, var(--diff-removed-bg) 78%, var(--tool-output-bg));
        --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--diff-added-bg) 92%, var(--diff-added-accent));
        --diffs-bg-deletion-emphasis-override: color-mix(in srgb, var(--diff-removed-bg) 92%, var(--diff-removed-accent));
        --diffs-bg-selection-override: var(--selection-bg);
        --diffs-bg-selection-number-override: var(--selection-bg);
        --diffs-gap-style: 1px solid color-mix(in srgb, var(--tool-output-border) 82%, transparent);
        --diffs-min-number-column-width-default: 2ch;
      }

      [data-diff],
      [data-file],
      pre,
      code {
        background: var(--tool-output-bg);
        color: var(--text);
      }

      [data-column-number],
      [data-gutter-buffer] {
        border-right-color: color-mix(in srgb, var(--tool-output-border) 82%, transparent);
      }

      [data-line-type="change-addition"] {
        color: var(--diff-added-text);
      }

      [data-line-type="change-deletion"] {
        color: var(--diff-removed-text);
      }

      [data-separator="line-info"],
      [data-separator="line-info-basic"],
      [data-separator="metadata"],
      [data-diffs-header="default"] {
        color: var(--text-subtle);
        background: var(--diff-header-bg);
      }
    `;
  }

  function ensureDiffThemesRegistered() {
    const pair = readThemePairFromDom();
    const darkName = `pi-web-diff-${pair.dark.id}`;
    const lightName = `pi-web-diff-${pair.light.id}`;

    if (!REGISTERED_DIFF_THEMES.has(darkName)) {
      registerCustomTheme(darkName, async () => ({
        ...resolveShikiTheme(pair.dark),
        name: darkName,
      }));
      REGISTERED_DIFF_THEMES.add(darkName);
    }
    if (!REGISTERED_DIFF_THEMES.has(lightName)) {
      registerCustomTheme(lightName, async () => ({
        ...resolveShikiTheme(pair.light),
        name: lightName,
      }));
      REGISTERED_DIFF_THEMES.add(lightName);
    }

    return { dark: darkName, light: lightName };
  }

  function diffOptions() {
    return {
      diffStyle: "unified" as const,
      disableFileHeader: true,
      overflow: "scroll" as const,
      theme: ensureDiffThemesRegistered(),
      themeType: readThemeModeFromDom(),
      unsafeCSS: themedUnsafeCss(),
    };
  }

  function classifyLine(
    line: string,
  ): "header" | "hunk" | "added" | "removed" | "context" {
    if (line.startsWith("+++") || line.startsWith("---")) return "header";
    if (line.startsWith("@@")) return "hunk";
    if (line.startsWith("+")) return "added";
    if (line.startsWith("-")) return "removed";
    return "context";
  }

  function hasRenderableDiff(
    fileDiff:
      | {
          hunks?: unknown[];
        }
      | undefined,
  ) {
    return Array.isArray(fileDiff?.hunks) && fileDiff.hunks.length > 0;
  }

  function safeDisplayPath() {
    return (path || "file.txt").replace(/^\.?\//, "").replace(/\\/g, "/");
  }

  function wrapPatchWithFileHeaders(patchText: string) {
    const safePath = safeDisplayPath();
    return `--- a/${safePath}\n+++ b/${safePath}\n${patchText}`;
  }

  function looksLikePatch(patchText: string) {
    if (!patchText) return false;
    return (
      patchText.startsWith("--- ") ||
      patchText.startsWith("+++ ") ||
      patchText.includes("\n@@ ") ||
      patchText.startsWith("@@ ")
    );
  }

  function lineCount(text: string) {
    if (!text) return 0;
    const lines = text.replace(/\r/g, "").split("\n");
    if (lines.at(-1) === "") lines.pop();
    return lines.length;
  }

  function ensureTrailingNewline(text: string) {
    if (!text) return "";
    return text.endsWith("\n") ? text : `${text}\n`;
  }

  function splitLines(text: string) {
    if (!text) return [];
    return ensureTrailingNewline(text.replace(/\r/g, "")).split("\n").slice(0, -1);
  }

  function commonPrefixCount(left: string[], right: string[]) {
    let count = 0;
    while (count < left.length && count < right.length && left[count] === right[count]) {
      count += 1;
    }
    return count;
  }

  function commonSuffixCount(left: string[], right: string[], prefixCount: number) {
    let count = 0;
    const leftLimit = left.length - prefixCount;
    const rightLimit = right.length - prefixCount;
    while (
      count < leftLimit &&
      count < rightLimit &&
      left[left.length - 1 - count] === right[right.length - 1 - count]
    ) {
      count += 1;
    }
    return count;
  }

  function synthesizePatchFromEdits(editList: DiffEdit[]) {
    if (editList.length === 0) return "";

    const lines = [`--- a/${safeDisplayPath()}`, `+++ b/${safeDisplayPath()}`];
    let oldLine = 1;
    let newLine = 1;

    for (const edit of editList) {
      const oldLines = splitLines(edit.oldText);
      const newLines = splitLines(edit.newText);
      const prefixCount = commonPrefixCount(oldLines, newLines);
      const suffixCount = commonSuffixCount(oldLines, newLines, prefixCount);

      const contextBefore = oldLines.slice(0, prefixCount);
      const removedLines = oldLines.slice(prefixCount, oldLines.length - suffixCount);
      const addedLines = newLines.slice(prefixCount, newLines.length - suffixCount);
      const contextAfter = oldLines.slice(oldLines.length - suffixCount);

      const hunkOldCount = contextBefore.length + removedLines.length + contextAfter.length;
      const hunkNewCount = contextBefore.length + addedLines.length + contextAfter.length;
      const hunkOldStart = oldLine;
      const hunkNewStart = newLine;

      lines.push(`@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`);
      for (const line of contextBefore) lines.push(` ${line}`);
      for (const line of removedLines) lines.push(`-${line}`);
      for (const line of addedLines) lines.push(`+${line}`);
      for (const line of contextAfter) lines.push(` ${line}`);

      oldLine += Math.max(oldLines.length, 1);
      newLine += Math.max(newLines.length, 1);
    }

    return lines.join("\n");
  }

  function parseDiffText(patchText: string) {
    const candidates: string[] = [];
    if (looksLikePatch(patchText)) {
      candidates.push(patchText);
      if (!patchText.startsWith("--- ") && !patchText.startsWith("+++ ")) {
        candidates.push(wrapPatchWithFileHeaders(patchText));
      }
    }

    if (syntheticPatch) candidates.push(syntheticPatch);
    if (patchText && !looksLikePatch(patchText)) candidates.push(patchText);

    for (const candidate of candidates) {
      const fileDiff = processFile(candidate, {
        cacheKey: path,
        throwOnError: true,
      });
      if (hasRenderableDiff(fileDiff)) return fileDiff;
    }

    throw new Error("Unsupported diff format for @pierre/diffs");
  }

  function applyRenderedHtml() {
    if (!host) return;
    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = renderedHtml;
  }

  async function renderDiff() {
    const version = ++renderVersion;
    if (!fallbackText) {
      renderedHtml = "";
      renderError = "";
      loading = false;
      return;
    }

    loading = true;

    try {
      const fileDiff = parseDiffText(normalizedDiff);
      const result = await preloadFileDiff({
        fileDiff,
        options: diffOptions(),
      });
      if (version !== renderVersion) return;
      renderedHtml = result.prerenderedHTML;
      renderError = "";
      applyRenderedHtml();
    } catch (error) {
      if (version !== renderVersion) return;
      renderedHtml = "";
      renderError =
        error instanceof Error ? error.message : "Failed to render diff";
      applyRenderedHtml();
    } finally {
      if (version === renderVersion) loading = false;
    }
  }

  $effect(() => {
    void [host, renderedHtml];
    applyRenderedHtml();
  });

  $effect(() => {
    void [normalizedDiff, path, edits];
    void renderDiff();
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
      renderVersion += 1;
      themeObserver?.disconnect();
    };
  });
</script>

<div class="diff-view-shell">
  <div bind:this={host} class="diff-view-host"></div>

  {#if loading && !renderedHtml && !renderError}
    <div class="diff-view-status">Loading diff...</div>
  {:else if !renderedHtml && fallbackText}
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
