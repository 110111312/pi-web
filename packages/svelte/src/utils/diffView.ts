import type { FileDiffMetadata } from "@pierre/diffs";
import {
  readThemeModeFromDom,
  readThemePairFromDom,
  resolveShikiTheme,
} from "../themes";

export type DiffEdit = { oldText: string; newText: string };
export type ReadWorkspaceFile = (path: string) => Promise<{ content: string }>;
export type DiffsModule = typeof import("@pierre/diffs");
export type FileDiffRenderer = InstanceType<DiffsModule["FileDiff"]>;

export type NumberedDiffLine = {
  kind: "context" | "removed" | "added";
  lineNumber: number;
  text: string;
};

export type DiffLineKind =
  | "header"
  | "hunk"
  | "added"
  | "removed"
  | "context";

const REGISTERED_DIFF_THEMES = new Set<string>();

export function safeDisplayPath(path: string | undefined): string {
  return (path || "file.txt").replace(/^\.?\//, "").replace(/\\/g, "/");
}

export function wrapPatchWithFileHeaders(
  patchText: string,
  safePath: string,
): string {
  return `--- a/${safePath}\n+++ b/${safePath}\n${patchText}`;
}

export function looksLikePatch(patchText: string): boolean {
  if (!patchText) return false;
  return (
    patchText.startsWith("--- ") ||
    patchText.startsWith("+++ ") ||
    patchText.includes("\n@@ ") ||
    patchText.startsWith("@@ ")
  );
}

export function parseNumberedEditLine(
  line: string,
): NumberedDiffLine | "gap" | undefined {
  const indicator = line[0];
  if (indicator !== " " && indicator !== "+" && indicator !== "-") return undefined;

  const content = line.slice(1);
  if (/^\s*\.\.\.\s*$/.test(content)) return "gap";

  const match = content.match(/^\s*(\d+)\s(.*)$/);
  if (!match) return undefined;

  return {
    kind:
      indicator === "+"
        ? "added"
        : indicator === "-"
          ? "removed"
          : "context",
    lineNumber: Number(match[1]),
    text: match[2] ?? "",
  };
}

export function looksLikeNumberedEditDiff(diffText: string): boolean {
  if (!diffText || looksLikePatch(diffText)) return false;
  const lines = diffText.split("\n").filter(line => line.length > 0);
  if (lines.length === 0) return false;

  let parsed = 0;
  let changed = 0;
  for (const line of lines) {
    const parsedLine = parseNumberedEditLine(line);
    if (!parsedLine) return false;
    if (parsedLine === "gap") continue;
    parsed += 1;
    if (parsedLine.kind !== "context") changed += 1;
  }

  return parsed > 0 && changed > 0;
}

export function classifyLine(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) return "header";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}

export function hasRenderableDiff(
  fileDiff: FileDiffMetadata | undefined,
): fileDiff is FileDiffMetadata {
  return Array.isArray(fileDiff?.hunks) && fileDiff.hunks.length > 0;
}

function hunkHeaderCount(count: number): string {
  return count === 1 ? "" : `,${count}`;
}

function appendNumberedEditHunk(
  patchLines: string[],
  hunkLines: NumberedDiffLine[],
  lineDelta: number,
): number {
  if (hunkLines.length === 0) return 0;

  const firstLine = hunkLines[0]!;
  const oldStart =
    firstLine.kind === "added"
      ? Math.max(1, firstLine.lineNumber - lineDelta)
      : firstLine.lineNumber;
  const newStart =
    firstLine.kind === "removed"
      ? Math.max(1, firstLine.lineNumber + lineDelta)
      : firstLine.lineNumber;
  let oldCount = 0;
  let newCount = 0;

  for (const line of hunkLines) {
    if (line.kind !== "added") oldCount += 1;
    if (line.kind !== "removed") newCount += 1;
  }

  patchLines.push(
    `@@ -${oldStart}${hunkHeaderCount(oldCount)} +${newStart}${hunkHeaderCount(newCount)} @@`,
  );

  for (const line of hunkLines) {
    const indicator =
      line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
    patchLines.push(`${indicator}${line.text}`);
  }

  return newCount - oldCount;
}

export function numberedEditDiffToPatch(diffText: string, path?: string): string {
  const safePath = safeDisplayPath(path);
  const patchLines: string[] = [
    `--- a/${safePath}`,
    `+++ b/${safePath}`,
  ];
  let hunkLines: NumberedDiffLine[] = [];
  let lineDelta = 0;

  for (const line of diffText.split("\n")) {
    if (!line) continue;

    const parsedLine = parseNumberedEditLine(line);
    if (!parsedLine) throw new Error("Unsupported numbered edit diff format");
    if (parsedLine === "gap") {
      lineDelta += appendNumberedEditHunk(patchLines, hunkLines, lineDelta);
      hunkLines = [];
      continue;
    }

    hunkLines.push(parsedLine);
  }

  appendNumberedEditHunk(patchLines, hunkLines, lineDelta);
  return patchLines.join("\n");
}

export function ensureTrailingNewline(text: string): string {
  if (!text) return "";
  return text.endsWith("\n") ? text : `${text}\n`;
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function splitLines(text: string): string[] {
  if (!text) return [];
  return ensureTrailingNewline(normalizeLineEndings(text)).split("\n").slice(0, -1);
}

function commonPrefixCount(left: string[], right: string[]): number {
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) {
    count += 1;
  }
  return count;
}

function commonSuffixCount(
  left: string[],
  right: string[],
  prefixCount: number,
): number {
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

function locateTextLine(
  content: string | null,
  text: string,
  fromIndex: number,
): { lineNumber: number; endIndex: number } | undefined {
  if (!content || !text) return undefined;
  const normalizedText = normalizeLineEndings(text);
  if (!normalizedText) return undefined;

  const index = content.indexOf(normalizedText, fromIndex);
  if (index === -1) return undefined;

  return {
    lineNumber: content.slice(0, index).split("\n").length,
    endIndex: index + normalizedText.length,
  };
}

export function synthesizePatchFromEdits(
  editList: DiffEdit[],
  fileContent: string | null,
  displayPath: string | undefined,
): string {
  if (editList.length === 0 || fileContent === null) return "";

  const safePath = safeDisplayPath(displayPath);
  const lines: string[] = [`--- a/${safePath}`, `+++ b/${safePath}`];
  const normalizedFileContent = normalizeLineEndings(fileContent);
  let searchIndex = 0;
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
    const located =
      locateTextLine(normalizedFileContent, edit.newText, searchIndex) ??
      locateTextLine(normalizedFileContent, edit.oldText, searchIndex);
    const hunkOldStart = located?.lineNumber ?? oldLine;
    const hunkNewStart = located?.lineNumber ?? newLine;

    lines.push(`@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`);
    for (const line of contextBefore) lines.push(` ${line}`);
    for (const line of removedLines) lines.push(`-${line}`);
    for (const line of addedLines) lines.push(`+${line}`);
    for (const line of contextAfter) lines.push(` ${line}`);

    if (located) searchIndex = located.endIndex;
    oldLine = hunkOldStart + Math.max(hunkOldCount, 1);
    newLine = hunkNewStart + Math.max(hunkNewCount, 1);
  }

  return lines.join("\n");
}

export function parseDiffText(
  patchText: string,
  processFile: DiffsModule["processFile"],
  path: string | undefined,
  syntheticPatch: string,
): FileDiffMetadata {
  const candidates: string[] = [];

  if (syntheticPatch) candidates.push(syntheticPatch);
  if (looksLikeNumberedEditDiff(patchText)) {
    candidates.push(numberedEditDiffToPatch(patchText, path));
  }
  if (looksLikePatch(patchText)) {
    candidates.push(patchText);
    if (!patchText.startsWith("--- ") && !patchText.startsWith("+++ ")) {
      candidates.push(wrapPatchWithFileHeaders(patchText, safeDisplayPath(path)));
    }
  }

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

export function themedUnsafeCss(): string {
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

    [data-line-type="change-addition"],
    [data-line-type="change-addition"] + [data-no-newline],
    [data-column-number][data-line-type="change-addition"] {
      background: var(--diffs-bg-addition);
    }

    [data-line-type="change-addition"] {
      color: var(--diff-added-text);
    }

    [data-line-type="change-deletion"],
    [data-line-type="change-deletion"] + [data-no-newline],
    [data-column-number][data-line-type="change-deletion"] {
      background: var(--diffs-bg-deletion);
    }

    [data-line-type="change-deletion"] {
      color: var(--diff-removed-text);
    }

    [data-separator="line-info"],
    [data-separator="line-info-basic"],
    [data-separator="metadata"],
    [data-separator="simple"],
    [data-diffs-header="default"] {
      color: var(--text-subtle);
      background: var(--diff-header-bg);
    }

    [data-separator="simple"] {
      min-height: 1px;
    }
  `;
}

export function ensureDiffThemesRegistered(
  registerCustomTheme: DiffsModule["registerCustomTheme"],
): { dark: string; light: string } {
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

export function diffOptions(
  registerCustomTheme: DiffsModule["registerCustomTheme"],
) {
  return {
    diffStyle: "unified" as const,
    diffIndicators: "none" as const,
    disableFileHeader: true,
    hunkSeparators: "simple" as const,
    overflow: "scroll" as const,
    theme: ensureDiffThemesRegistered(registerCustomTheme),
    themeType: readThemeModeFromDom(),
    unsafeCSS: themedUnsafeCss(),
  };
}

export type DiffLine = {
  text: string;
  kind: DiffLineKind;
};

export function buildFallbackLines(fallbackText: string): DiffLine[] {
  return fallbackText.split("\n").map(line => ({
    text: line,
    kind: classifyLine(line),
  }));
}