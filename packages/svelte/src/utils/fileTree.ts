import type { RpcWorkspaceEntry } from "@pi-web/bridge/types";

export interface FileTreeNode {
  /** Relative path joined by "/", e.g. "src/components/App.svelte" */
  path: string;
  /** Last path segment, e.g. "App.svelte" */
  name: string;
  kind: "file" | "directory";
  children: FileTreeNode[];
}

/**
 * Convert a flat list of workspace entries into a tree structure.
 *
 * Intermediate directories that aren't explicitly listed (because they're
 * inferred from file paths) are represented as inferred directory nodes with
 * no explicit kind. These inferred nodes participate in sort order but are
 * not included in the input entries themselves.
 */
export function buildFileTree(
  entries: readonly RpcWorkspaceEntry[],
): FileTreeNode[] {
  const root: FileTreeNode = {
    path: "",
    name: "",
    kind: "directory",
    children: [],
  };

  for (const entry of entries) {
    const normalizedPath = normalizePath(entry.path);
    if (!normalizedPath) continue;

    const segments = normalizedPath.split("/");
    let current = root;

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const isLeaf = i === segments.length - 1;
      const pathSoFar = segments.slice(0, i + 1).join("/");

      let child = current.children.find(node => node.name === segment);
      if (!child) {
        child = {
          path: pathSoFar,
          name: segment,
          kind: isLeaf ? entry.kind : "directory",
          children: [],
        };
        current.children.push(child);
      } else if (isLeaf && entry.kind === "directory") {
        // Explicitly listing a directory should upgrade an inferred node.
        child.kind = "directory";
      }

      current = child;
    }
  }

  return sortFileTree(root.children);
}

/**
 * Recursively sort a tree so directories come before files and children are
 * sorted alphabetically (case-insensitive). Returns a new tree — does not
 * mutate the input.
 */
export function sortFileTree(nodes: FileTreeNode[]): FileTreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  for (const node of sorted) {
    if (node.children.length > 0) {
      node.children = sortFileTree(node.children);
    }
  }

  return sorted;
}

/**
 * Filter a tree to nodes that match the given query. The query is matched
 * against node name (case-insensitive substring). Ancestor directories of any
 * matching node are retained so the structure stays navigable.
 *
 * If the query is empty, the original tree is returned unchanged.
 */
export function filterFileTree(
  nodes: FileTreeNode[],
  query: string,
): FileTreeNode[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return nodes;

  const result: FileTreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === "file") {
      if (node.name.toLowerCase().includes(trimmed)) {
        result.push(node);
      }
      continue;
    }

    const nameMatches = node.name.toLowerCase().includes(trimmed);
    const filteredChildren = filterFileTree(node.children, query);

    if (nameMatches || filteredChildren.length > 0) {
      result.push({
        ...node,
        children: filteredChildren,
      });
    }
  }
  return result;
}

/**
 * Flatten every file path in a tree (depth-first). Useful for "open all"
 * style helpers if needed later.
 */
export function flattenFilePaths(nodes: FileTreeNode[]): string[] {
  const result: string[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node) break;
    if (node.kind === "file") {
      result.push(node.path);
    } else {
      stack.unshift(...node.children);
    }
  }
  return result;
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}