// Static fixture constants used by the progressive debug fixtures below.
// These are intentionally large, in-memory data blocks that exercise the
// transcript renderer. They live in their own module so the streaming
// builders and fixture dispatch stay small and focused.

export const MARKDOWN_FIXTURE_LINES = [
  "## Markdown Fixture",
  "",
  "Use this to verify headings, emphasis, lists, tables, code fences, inline file refs, and Mermaid.",
  "",
  "- Bold: **important**",
  "- Italic: *subtle*",
  "- Inline code: `packages/svelte/src/components/ChatTranscript.svelte:564`",
  "",
  "| Column | Value |",
  "| --- | --- |",
  "| Mode | Debug |",
  "| Scope | In-memory session |",
  "",
  "> Blockquotes and file references should keep the renderer stable.",
  "",
  "```ts",
  "export function renderPreview(name: string) {",
  "  return `hello ${name}`;",
  "}",
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  "  User --> ChatTranscript",
  "  ChatTranscript --> MarkdownRenderer",
  "```",
];

export const READ_FIXTURE_PATH =
  "packages/svelte/src/components/ChatTranscript.svelte";

export const READ_FIXTURE_ARGS = {
  path: READ_FIXTURE_PATH,
  offset: 552,
  limit: 40,
};

export const READ_FIXTURE_RESULT = [
  '{#if block.kind === "tool"}',
  '  <div class="tool-inline-block" data-tree-entry-id={block.resultSourceMessageId}>',
  '    <div class="tool-inline" data-status={toolBlockDescriptor(block).status}>',
  "      <button",
  '        type="button"',
  '        class="tool-inline-toggle"',
  "        onclick={() => blockState.toggleToolBlock(messageStableKey(item.message, item.messageIndex), bIdx)}",
  "        aria-expanded={blockState.isToolBlockExpanded(messageStableKey(item.message, item.messageIndex), bIdx)}",
  "      >",
  '        <span class="tool-inline-summary">',
  '          <span class="tool-inline-name">{toolBlockDescriptor(block).name}</span>',
  "        </span>",
  "      </button>",
  "    </div>",
  "  </div>",
  "{/if}",
].join("\n");

export const BASH_FIXTURE_ARGS = {
  command: [
    "pnpm -C packages/svelte check",
    "pnpm run build:web",
    'rg -n "MarkdownRenderer" packages/svelte/src/components/ChatTranscript.svelte',
  ].join("\n"),
  timeout: 180,
};

export const BASH_FIXTURE_PARTIAL_OUTPUT = [
  "> @pi-web/svelte check",
  "Loading svelte-check...",
  "svelte-check found 0 errors and 0 warnings",
  "",
  "> @woxqaq/pi-web build:web",
  "vite v8 building client environment for production...",
  "transforming modules...",
].join("\n");

export const BASH_FIXTURE_FINAL_OUTPUT = [
  BASH_FIXTURE_PARTIAL_OUTPUT,
  "rendering chunks...",
  "computing gzip size...",
  "../../web-dist/assets/index.js 536.07 kB | gzip: 184.87 kB",
  "../../web-dist/assets/vendor-mermaid.js 1557.84 kB | gzip: 489.70 kB",
  "packages/svelte/src/components/ChatTranscript.svelte:564:                <MarkdownRenderer",
  "Done in 1.03s.",
  "Command exited with code 0",
].join("\n");

export const EDIT_FIXTURE_ONE_ARGS = {
  path: "packages/svelte/src/App.svelte",
  edits: [
    {
      oldText: "let debugSessionsEnabled = $derived(debugModeAvailable);",
      newText: [
        "let debugSessionsEnabled = $derived(",
        "  debugModeAvailable && (showDebugFixtures || debugSessions.length > 0),",
        ");",
      ].join("\n"),
    },
    {
      oldText: "const debugWorkspaceSummary = createDebugWorkspaceSummary();",
      newText: [
        "const debugWorkspaceSummary = createDebugWorkspaceSummary({",
        '  accent: "violet",',
        '  labelSuffix: " local-only",',
        "});",
      ].join("\n"),
    },
    {
      oldText: "scheduleDebugStream(activeDebugSessionPath, stream);",
      newText: [
        "scheduleDebugStream(activeDebugSessionPath, stream, {",
        "  announce: true,",
        "  preserveExpandedBlocks: true,",
        "});",
      ].join("\n"),
    },
    {
      oldText: "pendingRevision = null;",
      newText: [
        "pendingRevision = null;",
        "editQueuedPayload = null;",
        "debugLastAppliedFixture = payload.message;",
      ].join("\n"),
    },
  ],
};

export const EDIT_FIXTURE_ONE_DIFF = [
  "--- a/packages/svelte/src/App.svelte",
  "+++ b/packages/svelte/src/App.svelte",
  "@@ -78,7 +78,10 @@",
  "-const debugWorkspaceSummary = createDebugWorkspaceSummary();",
  "+const debugWorkspaceSummary = createDebugWorkspaceSummary({",
  '+  accent: "violet",',
  '+  labelSuffix: " local-only",',
  "+});",
  "@@ -258,7 +261,9 @@",
  "-let debugSessionsEnabled = $derived(debugModeAvailable);",
  "+let debugSessionsEnabled = $derived(",
  "+  debugModeAvailable && (showDebugFixtures || debugSessions.length > 0),",
  "+);",
  "@@ -894,7 +899,12 @@",
  "-pendingRevision = null;",
  "+pendingRevision = null;",
  "+editQueuedPayload = null;",
  "+debugLastAppliedFixture = payload.message;",
].join("\n");

export const EDIT_FIXTURE_TWO_ARGS = {
  path: "packages/svelte/src/utils/mermaidUtils.ts",
  edits: [
    {
      oldText: "let placeholderIndex = 0;",
      newText: "let placeholderIndex = clampPlaceholderIndex(placeholderIndex);",
    },
    {
      oldText: "function clampPlaceholderIndex(value: number): number {",
      newText:
        "function clampPlaceholderIndex(value: number, max: number = 64): number {",
    },
    {
      oldText: "  return Math.max(0, Math.min(max, Math.round(value)));",
      newText:
        "  return Math.max(0, Math.min(max, Math.round(value || 0)));",
    },
  ],
};

export const EDIT_FIXTURE_TWO_DIFF = [
  "--- a/packages/svelte/src/utils/mermaidUtils.ts",
  "+++ b/packages/svelte/src/utils/mermaidUtils.ts",
  "@@ -12,7 +12,7 @@",
  "-let placeholderIndex = 0;",
  "+let placeholderIndex = clampPlaceholderIndex(placeholderIndex);",
  "@@ -34,7 +34,7 @@",
  "-function clampPlaceholderIndex(value: number): number {",
  "+function clampPlaceholderIndex(value: number, max: number = 64): number {",
  "@@ -42,7 +42,7 @@",
  "-  return Math.max(0, Math.min(max, Math.round(value)));",
  "+  return Math.max(0, Math.min(max, Math.round(value || 0)));",
].join("\n");

export const WRITE_FIXTURE_PATH = "packages/svelte/src/utils/debugPreviewRegistry.ts";

export const WRITE_FIXTURE_CONTENT = [
  "import type { DebugPromptFixture } from \"@pi-web/svelte/debugPreviewRegistry\";",
  "",
  "export const debugPreviewFixtures: readonly DebugPromptFixture[] = [",
  "  {",
  '    name: "markdown",',
  '    description: "Markdown rendering smoke test",',
  '    tags: ["markdown", "smoke"],',
  "  },",
  "  {",
  '    name: "tool-read",',
  '    description: "Read tool call with expandable code panel",',
  '    tags: ["tool", "read"],',
  "  },",
  "];",
  "",
].join("\n");

export const ERROR_FIXTURE_MESSAGE =
  "The debug fixture aborted because no Mermaid placeholder slot was available.";