import {
  BASH_FIXTURE_ARGS,
  BASH_FIXTURE_FINAL_OUTPUT,
  BASH_FIXTURE_PARTIAL_OUTPUT,
  MARKDOWN_FIXTURE_LINES,
  READ_FIXTURE_ARGS,
  READ_FIXTURE_PATH,
  READ_FIXTURE_RESULT,
} from "./debugSessionFixtures";
import { materializeMessage } from "./debugSessionMessages";
import {
  buildSnapshotStream,
  buildTextStream,
} from "./debugSessionStreamBuilders";
import type {
  DebugPromptResult,
  DebugSession,
} from "./debugSessionTypes";
import { nextDebugId } from "./debugSessionTypes";

export function progressiveMarkdownFixture(
  session: DebugSession,
): DebugPromptResult {
  return buildTextStream(session, MARKDOWN_FIXTURE_LINES, 4);
}

export function progressiveReadFixture(
  session: DebugSession,
): DebugPromptResult {
  const assistantId = nextDebugId("msg");
  const toolCallId = nextDebugId("tool");
  const intro = [
    "### Read Fixture",
    "",
    `Inspecting \`${READ_FIXTURE_PATH}\` to verify code rendering, file references, and expanded tool details.`,
  ].join("\n");
  const outro = [
    "### Read Summary",
    "",
    "- Read blocks should open as code panels.",
    "- File references like `packages/svelte/src/components/ChatTranscript.svelte:564` should stay clickable.",
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
          name: "read",
          arguments: READ_FIXTURE_ARGS,
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
          name: "read",
          arguments: READ_FIXTURE_ARGS,
        },
        {
          type: "toolResult",
          content: [{ type: "text", text: READ_FIXTURE_RESULT }],
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
          name: "read",
          arguments: READ_FIXTURE_ARGS,
        },
        {
          type: "toolResult",
          content: [{ type: "text", text: READ_FIXTURE_RESULT }],
        },
        { type: "text", text: outro },
      ],
    }),
  ];

  return buildSnapshotStream(session, [], snapshots, [
    `${intro}\nread ${JSON.stringify(READ_FIXTURE_ARGS)}`,
    READ_FIXTURE_RESULT,
    outro,
  ]);
}

export function progressiveBashFixture(
  session: DebugSession,
): DebugPromptResult {
  const assistantId = nextDebugId("msg");
  const toolCallId = nextDebugId("tool");
  const intro = [
    "### Bash Fixture",
    "",
    "Running a synthetic build command to stress the bash tool output panel and summary metadata.",
  ].join("\n");
  const outro = [
    "### Bash Summary",
    "",
    "- Multi-line commands should keep the `$ ...` preview.",
    "- Long output should remain scrollable inside the tool block.",
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
          name: "bash",
          arguments: BASH_FIXTURE_ARGS,
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
          name: "bash",
          arguments: BASH_FIXTURE_ARGS,
        },
        {
          type: "toolResult",
          content: [{ type: "text", text: BASH_FIXTURE_PARTIAL_OUTPUT }],
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
          name: "bash",
          arguments: BASH_FIXTURE_ARGS,
        },
        {
          type: "toolResult",
          content: [{ type: "text", text: BASH_FIXTURE_FINAL_OUTPUT }],
        },
        { type: "text", text: outro },
      ],
    }),
  ];

  return buildSnapshotStream(session, [], snapshots, [
    `${intro}\n${BASH_FIXTURE_ARGS.command}`,
    BASH_FIXTURE_PARTIAL_OUTPUT,
    `${BASH_FIXTURE_FINAL_OUTPUT}\n${outro}`,
  ]);
}