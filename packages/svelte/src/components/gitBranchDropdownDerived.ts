import type {
  RpcGitBranch,
  RpcGitRepoEntry,
  RpcGitRepoState,
} from "@pi-web/bridge/types";
import { mergeBranchesFor } from "./gitBranchDropdownUtils";

/** A single repo's view-model in grouped mode. */
export type GroupEntry = {
  repo: RpcGitRepoEntry;
  state: RpcGitRepoState | null;
  loading: boolean;
  branches: RpcGitBranch[];
};

/** Flat entry across all repos for keyboard navigation and search. */
export type FlatEntry = {
  repo: RpcGitRepoEntry;
  branch: RpcGitBranch | null; // null = repo header row
  kind: "repo-header" | "branch";
};

/** Build grouped entries: each known repo + its loaded state + merged branches. */
export function buildGroupedEntries(
  repos: readonly RpcGitRepoEntry[],
  repoStateByRoot: Readonly<Record<string, RpcGitRepoState>>,
  repoStateLoadingByRoot: Readonly<Record<string, boolean>>,
): GroupEntry[] {
  return repos.map(repo => {
    const state = repoStateByRoot[repo.root] ?? null;
    const isLoading = !!repoStateLoadingByRoot[repo.root];
    const branches = mergeBranchesFor(state);
    return { repo, state, loading: isLoading, branches };
  });
}

/** Flat list (headers + branches) preserving repo order. */
export function buildFlatEntries(grouped: readonly GroupEntry[]): FlatEntry[] {
  const out: FlatEntry[] = [];
  for (const g of grouped) {
    out.push({ repo: g.repo, branch: null, kind: "repo-header" });
    for (const b of g.branches) {
      out.push({ repo: g.repo, branch: b, kind: "branch" });
    }
  }
  return out;
}

/**
 * Filtered branch-only entries.
 *
 * - With empty query: returns all branches in repo order.
 * - With query: filters by repo label or branch name (incl. remote
 *   display) case-insensitive.
 */
export function buildVisibleBranchEntries(
  grouped: readonly GroupEntry[],
  query: string,
): FlatEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    const out: FlatEntry[] = [];
    for (const g of grouped) {
      for (const b of g.branches) {
        out.push({ repo: g.repo, branch: b, kind: "branch" });
      }
    }
    return out;
  }
  const out: FlatEntry[] = [];
  for (const g of grouped) {
    if (g.repo.label.toLowerCase().includes(q)) {
      for (const b of g.branches) {
        out.push({ repo: g.repo, branch: b, kind: "branch" });
      }
      continue;
    }
    for (const b of g.branches) {
      const display =
        b.kind === "remote" && b.remoteName
          ? `${b.remoteName}/${b.shortName}`
          : b.shortName;
      const haystack = `${b.name} ${display}`.toLowerCase();
      if (haystack.includes(q)) {
        out.push({ repo: g.repo, branch: b, kind: "branch" });
      }
    }
  }
  return out;
}

/** Find a branch by exact short-name across all grouped entries. */
export function findGroupedExactBranch(
  grouped: readonly GroupEntry[],
  query: string,
): RpcGitBranch | null {
  const q = query.trim();
  if (!q) return null;
  for (const g of grouped) {
    const found = g.branches.find(b => b.name === q);
    if (found) return found;
  }
  return null;
}