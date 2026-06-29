import {
  EDIT_FIXTURE_ONE_ARGS,
  EDIT_FIXTURE_ONE_DIFF,
  EDIT_FIXTURE_TWO_ARGS,
  EDIT_FIXTURE_TWO_DIFF,
  WRITE_FIXTURE_CONTENT,
  WRITE_FIXTURE_PATH,
} from "./debugSessionFixtures";
import { materializeMessage } from "./debugSessionMessages";
import { buildSnapshotStream } from "./debugSessionStreamBuilders";
import type { DebugPromptResult, DebugSession } from "./debugSessionTypes";
import { nextDebugId } from "./debugSessionTypes";

export function progressiveEditFixture(
  session: DebugSession,
): DebugPromptResult {
  const assistantId = nextDebugId("msg");
  const toolCallOneId = nextDebugId("tool");
  const toolCallTwoId = nextDebugId("tool");
  const intro = [
    "### Edit Fixture",
    "",
    "Applying two synthetic edit passes so the transcript shows multiple diff-heavy tool blocks in a single assistant response.",
  ].join("\n");
  const transition = [
    "### Second Edit Pass",
    "",
    "Follow-up edits tighten the Mermaid placeholder guard and add a stability marker reset.",
  ].join("\n");
  const partialDiffOne = EDIT_FIXTURE_ONE_DIFF.split("\n")
    .slice(0, 12)
    .join("\n");
  const partialDiffTwo = EDIT_FIXTURE_TWO_DIFF.split("\n")
    .slice(0, 10)
    .join("\n");
  const outro = [
    "### Edit Summary",
    "",
    "- Two separate edit blocks should stack cleanly in one assistant message.",
    "- Each block should show diff stats, expanded diff content, and its own path/edits payload.",
    "- The second block should feel substantial enough to test scrolling inside the diff viewer.",
  ].join("\n");

  const snapshots = [
    materializeMessage({
      id: assistantId,
      role: "assistant",
      content: [{ type: "text", text: intro }],
    }),
    materializeMessage({
      id: assistantId,
      role: "assistant",
      content: [
        { type: "text", text: intro },
        {
          type: "toolCall",
          id: toolCallOneId,
          name: "edit",
          arguments: EDIT_FIXTURE_ONE_ARGS,
        },
      ],
    }),
    materializeMessage({
      id: assistantId,
      role: "assistant",
      content: [
        { type: "text", text: intro },
        {
          type: "toolCall",
          id: toolCallOneId,
          name: "edit",
          arguments: EDIT_FIXTURE_ONE_ARGS,
        },
        {
          type: "toolResult",
          content: [
            {
              type: "text",
              text: "Applied 4 targeted replacements in App.svelte.",
            },
          ],
          details: { diff: partialDiffOne },
        },
      ],
    }),
    materializeMessage({
      id: assistantId,
      role: "assistant",
      content: [
        { type: "text", text: intro },
        {
          type: "toolCall",
          id: toolCallOneId,
          name: "edit",
          arguments: EDIT_FIXTURE_ONE_ARGS,
        },
        {
          type: "toolResult",
          content: [
            {
              type: "text",
              text: "Applied 4 targeted replacements in App.svelte.",
            },
          ],
          details: { diff: EDIT_FIXTURE_ONE_DIFF },
        },
        { type: "text", text: transition },
        {
          type: "toolCall",
          id: toolCallTwoId,
          name: "edit",
          arguments: EDIT_FIXTURE_TWO_ARGS,
        },
      ],
    }),
    materializeMessage({
      id: assistantId,
      role: "assistant",
      content: [
        { type: "text", text: intro },
        {
          type: "toolCall",
          id: toolCallOneId,
          name: "edit",
          arguments: EDIT_FIXTURE_ONE_ARGS,
        },
        {
          type: "toolResult",
          content: [
            {
              type: "text",
              text: "Applied 4 targeted replacements in App.svelte.",
            },
          ],
          details: { diff: EDIT_FIXTURE_ONE_DIFF },
        },
        { type: "text", text: transition },
        {
          type: "toolCall",
          id: toolCallTwoId,
          name: "edit",
          arguments: EDIT_FIXTURE_TWO_ARGS,
        },
        {
          type: "toolResult",
          content: [
            {
              type: "text",
              text: "Applied 3 targeted replacements in MarkdownRenderer.svelte.",
            },
          ],
          details: { diff: partialDiffTwo },
        },
      ],
    }),
    materializeMessage({
      id: assistantId,
      role: "assistant",
      content: [
        { type: "text", text: intro },
        {
          type: "toolCall",
          id: toolCallOneId,
          name: "edit",
          arguments: EDIT_FIXTURE_ONE_ARGS,
        },
        {
          type: "toolResult",
          content: [
            {
              type: "text",
              text: "Applied 4 targeted replacements in App.svelte.",
            },
          ],
          details: { diff: EDIT_FIXTURE_ONE_DIFF },
        },
        { type: "text", text: transition },
        {
          type: "toolCall",
          id: toolCallTwoId,
          name: "edit",
          arguments: EDIT_FIXTURE_TWO_ARGS,
        },
        {
          type: "toolResult",
          content: [
            {
              type: "text",
              text: "Applied 3 targeted replacements in MarkdownRenderer.svelte.",
            },
          ],
          details: { diff: EDIT_FIXTURE_TWO_DIFF },
        },
        { type: "text", text: outro },
      ],
    }),
  ];

  return buildSnapshotStream(session, [], snapshots, [
    `${intro}\n${JSON.stringify(EDIT_FIXTURE_ONE_ARGS)}`,
    partialDiffOne,
    `${EDIT_FIXTURE_ONE_DIFF}\n${transition}\n${JSON.stringify(EDIT_FIXTURE_TWO_ARGS)}`,
    partialDiffTwo,
    `${EDIT_FIXTURE_TWO_DIFF}\n${outro}`,
  ]);
}

export function progressiveWriteFixture(
  session: DebugSession,
): DebugPromptResult {
  const assistantId = nextDebugId("msg");
  const toolCallId = nextDebugId("tool");

  const intro = [
    "### Write Fixture",
    "",
    `Creating \`${WRITE_FIXTURE_PATH}\` to verify the code preview path for write operations.`,
  ].join("\n");
  const outro = [
    "### Write Summary",
    "",
    "- The write tool should preview the written file from tool arguments.",
    "- Expanded state should show code even if the result text itself is short.",
  ].join("\n");

  const snapshots = [
    materializeMessage({
      id: assistantId,
      role: "assistant",
      content: [{ type: "text", text: intro }],
    }),
    materializeMessage({
      id: assistantId,
      role: "assistant",
      content: [
        { type: "text", text: intro },
        {
          type: "toolCall",
          id: toolCallId,
          name: "write",
          arguments: {
            path: WRITE_FIXTURE_PATH,
            content: WRITE_FIXTURE_CONTENT,
          },
        },
      ],
    }),
    materializeMessage({
      id: assistantId,
      role: "assistant",
      content: [
        { type: "text", text: intro },
        {
          type: "toolCall",
          id: toolCallId,
          name: "write",
          arguments: {
            path: WRITE_FIXTURE_PATH,
            content: WRITE_FIXTURE_CONTENT,
          },
        },
        {
          type: "toolResult",
          content: [{ type: "text", text: `Wrote ${WRITE_FIXTURE_PATH}` }],
        },
      ],
    }),
    materializeMessage({
      id: assistantId,
      role: "assistant",
      content: [
        { type: "text", text: intro },
        {
          type: "toolCall",
          id: toolCallId,
          name: "write",
          arguments: {
            path: WRITE_FIXTURE_PATH,
            content: WRITE_FIXTURE_CONTENT,
          },
        },
        {
          type: "toolResult",
          content: [{ type: "text", text: `Wrote ${WRITE_FIXTURE_PATH}` }],
        },
        { type: "text", text: outro },
      ],
    }),
  ];

  return buildSnapshotStream(session, [], snapshots, [
    `${intro}\n${WRITE_FIXTURE_CONTENT}`,
    `Wrote ${WRITE_FIXTURE_PATH}`,
    outro,
  ]);
}