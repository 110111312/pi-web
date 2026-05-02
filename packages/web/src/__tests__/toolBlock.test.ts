import { describe, expect, it } from "vitest";
import { buildToolDetailModel, buildToolInlineModel } from "../utils/toolBlock";
import type { ToolContentBlock } from "../utils/transcript";

describe("buildToolInlineModel", () => {
  it("renders read blocks around the target path and line range", () => {
    const block: ToolContentBlock = {
      kind: "tool",
      toolName: "read",
      toolArgs: { path: "src/main.ts", offset: 10, limit: 5 },
      argumentsText: '{"path":"src/main.ts","offset":10,"limit":5}',
      resultText: "const value = 1;\nconsole.log(value);",
      toolStatus: "success",
    };

    const model = buildToolInlineModel(block);
    expect(model.title).toBe("src/main.ts:10-14");
    expect(model.meta).toBeUndefined();
    expect(model.diffStats).toBeUndefined();
  });

  it("uses line counts for successful writes", () => {
    const block: ToolContentBlock = {
      kind: "tool",
      toolName: "write",
      toolArgs: { path: "README.md", content: "# Title\n\nBody copy" },
      argumentsText: '{"path":"README.md","content":"# Title\\n\\nBody copy"}',
      resultText: "Successfully wrote 18 bytes to README.md",
      toolStatus: "success",
    };

    const model = buildToolInlineModel(block);
    expect(model.title).toBe("README.md");
    expect(model.meta).toBe("3 lines");
  });

  it("renders write details from the file content instead of the success message", () => {
    const block: ToolContentBlock = {
      kind: "tool",
      toolName: "write",
      toolArgs: { path: "README.md", content: "# Title\n\nBody copy" },
      argumentsText: '{"path":"README.md","content":"# Title\\n\\nBody copy"}',
      resultText: "Successfully wrote 18 bytes to README.md",
      toolStatus: "success",
    };

    expect(buildToolDetailModel(block)).toEqual({
      kind: "code",
      path: "README.md",
      text: "# Title\n\nBody copy",
    });
  });

  it("shows bash exit code and timeout metadata", () => {
    const block: ToolContentBlock = {
      kind: "tool",
      toolName: "bash",
      toolArgs: { command: "pnpm test", timeout: 30 },
      argumentsText: '{"command":"pnpm test","timeout":30}',
      resultText: "Command exited with code 2",
      toolStatus: "error",
    };

    const model = buildToolInlineModel(block);
    expect(model.title).toBe("pnpm test");
    expect(model.meta).toBe("exit 2 · timeout 30s");
  });

  it("exposes edit diff stats when a diff is available", () => {
    const diff = [
      "--- src/app.ts",
      "+++ src/app.ts",
      "@@ -1,2 +1,3 @@",
      " const a = 1;",
      "+const b = 2;",
      "-return a;",
      "+return a + b;",
    ].join("\n");
    const block: ToolContentBlock = {
      kind: "tool",
      toolName: "edit",
      toolArgs: {
        path: "src/app.ts",
        edits: [
          { oldText: "const a = 1;", newText: "const a = 1;\nconst b = 2;" },
          { oldText: "return a;", newText: "return a + b;" },
        ],
      },
      argumentsText:
        '{"path":"src/app.ts","edits":[{"oldText":"const a = 1;","newText":"const a = 1;\\nconst b = 2;"},{"oldText":"return a;","newText":"return a + b;"}]}',
      resultText: "Successfully replaced 2 block(s) in src/app.ts.",
      resultDetails: { diff },
      toolStatus: "success",
    };

    const model = buildToolInlineModel(block);
    expect(model.title).toBe("src/app.ts");
    expect(model.meta).toBeUndefined();
    expect(model.diffStats).toEqual({ added: 2, removed: 1 });
  });

  it("hides edit diff stats when an edit does not succeed", () => {
    const block: ToolContentBlock = {
      kind: "tool",
      toolName: "edit",
      toolArgs: {
        path: "src/app.ts",
        edits: [
          { oldText: "const a = 1;", newText: "const a = 2;" },
          { oldText: "return a;", newText: "return b;" },
        ],
      },
      argumentsText:
        '{"path":"src/app.ts","edits":[{"oldText":"const a = 1;","newText":"const a = 2;"},{"oldText":"return a;","newText":"return b;"}]}',
      resultText: "Could not find the exact text to replace in src/app.ts.",
      toolStatus: "error",
    };

    const model = buildToolInlineModel(block);
    expect(model.meta).toBeUndefined();
    expect(model.diffStats).toBeUndefined();
  });
});
