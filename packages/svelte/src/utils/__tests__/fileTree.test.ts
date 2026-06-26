import type { RpcWorkspaceEntry } from "@pi-web/bridge/types";
import { describe, expect, it } from "vitest";
import {
  buildFileTree,
  filterFileTree,
  flattenFilePaths,
  sortFileTree,
} from "../fileTree";

const entry = (path: string, kind: "file" | "directory"): RpcWorkspaceEntry => ({
  path,
  kind,
});

describe("buildFileTree", () => {
  it("returns an empty array for empty input", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it("creates single-level entries without nesting", () => {
    const tree = buildFileTree([
      entry("package.json", "file"),
      entry("README.md", "file"),
    ]);

    expect(tree).toEqual([
      expect.objectContaining({ name: "package.json", path: "package.json", kind: "file", children: [] }),
      expect.objectContaining({ name: "README.md", path: "README.md", kind: "file", children: [] }),
    ]);
  });

  it("nests files under inferred directories", () => {
    const tree = buildFileTree([
      entry("src/index.ts", "file"),
      entry("src/utils/parse.ts", "file"),
    ]);

    expect(tree).toHaveLength(1);
    const src = tree[0];
    expect(src?.name).toBe("src");
    expect(src?.kind).toBe("directory");
    expect(src?.path).toBe("src");
    expect(src?.children).toHaveLength(2);

    const utils = src?.children.find(c => c.name === "utils");
    expect(utils?.kind).toBe("directory");
    expect(utils?.children).toEqual([
      expect.objectContaining({ name: "parse.ts", path: "src/utils/parse.ts", kind: "file" }),
    ]);
  });

  it("upgrades inferred directories to kind='directory' when explicitly listed", () => {
    const tree = buildFileTree([
      entry("src", "directory"),
      entry("src/app.ts", "file"),
    ]);

    const src = tree[0];
    expect(src?.kind).toBe("directory");
    expect(src?.children).toEqual([
      expect.objectContaining({ name: "app.ts", path: "src/app.ts", kind: "file" }),
    ]);
  });

  it("normalizes backslash-separated paths", () => {
    const tree = buildFileTree([entry("src\\app.ts", "file")]);
    expect(tree[0]?.children[0]?.path).toBe("src/app.ts");
  });

  it("ignores empty paths", () => {
    const tree = buildFileTree([entry("", "file"), entry("a.ts", "file")]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.name).toBe("a.ts");
  });
});

describe("sortFileTree", () => {
  it("puts directories before files at every level", () => {
    const tree = [
      { path: "z.txt", name: "z.txt", kind: "file" as const, children: [] },
      { path: "a-dir", name: "a-dir", kind: "directory" as const, children: [] },
      { path: "m.txt", name: "m.txt", kind: "file" as const, children: [] },
    ];
    const sorted = sortFileTree(tree);
    expect(sorted.map(n => n.kind)).toEqual(["directory", "file", "file"]);
    expect(sorted.map(n => n.name)).toEqual(["a-dir", "m.txt", "z.txt"]);
  });

  it("sorts children alphabetically (case-insensitive)", () => {
    const tree = [
      { path: "Banana", name: "Banana", kind: "file" as const, children: [] },
      { path: "apple", name: "apple", kind: "file" as const, children: [] },
      { path: "Cherry", name: "Cherry", kind: "file" as const, children: [] },
    ];
    expect(sortFileTree(tree).map(n => n.name)).toEqual([
      "apple",
      "Banana",
      "Cherry",
    ]);
  });

  it("recursively sorts nested children", () => {
    const tree = [
      {
        path: "src",
        name: "src",
        kind: "directory" as const,
        children: [
          { path: "src/z.ts", name: "z.ts", kind: "file" as const, children: [] },
          { path: "src/a.ts", name: "a.ts", kind: "file" as const, children: [] },
        ],
      },
    ];
    const sorted = sortFileTree(tree);
    expect(sorted[0]?.children.map(c => c.name)).toEqual(["a.ts", "z.ts"]);
  });
});

describe("filterFileTree", () => {
  const tree = buildFileTree([
    entry("src/index.ts", "file"),
    entry("src/utils/parse.ts", "file"),
    entry("docs/intro.md", "file"),
    entry("README.md", "file"),
  ]);

  it("returns the original tree when query is empty", () => {
    expect(filterFileTree(tree, "")).toBe(tree);
  });

  it("matches file names case-insensitively", () => {
    const filtered = filterFileTree(tree, "README");
    expect(filtered.map(n => n.name)).toEqual(["README.md"]);
  });

  it("keeps ancestor directories of matching files", () => {
    const filtered = filterFileTree(tree, "parse");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe("src");
    expect(filtered[0]?.children[0]?.name).toBe("utils");
    expect(filtered[0]?.children[0]?.children[0]?.name).toBe("parse.ts");
  });

  it("matches on directory names and keeps their descendants", () => {
    const filtered = filterFileTree(tree, "utils");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe("src");
    expect(filtered[0]?.children).toHaveLength(1);
    expect(filtered[0]?.children[0]?.name).toBe("utils");
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterFileTree(tree, "nothing-matches")).toEqual([]);
  });
});

describe("flattenFilePaths", () => {
  it("returns every file path in depth-first order", () => {
    const tree = buildFileTree([
      entry("a/b/c.ts", "file"),
      entry("a/d.ts", "file"),
      entry("z.ts", "file"),
    ]);
    expect(flattenFilePaths(tree)).toEqual(["a/b/c.ts", "a/d.ts", "z.ts"]);
  });

  it("returns empty array for empty tree", () => {
    expect(flattenFilePaths([])).toEqual([]);
  });
});