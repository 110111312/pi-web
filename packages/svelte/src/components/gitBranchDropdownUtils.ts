import type { RpcGitBranch, RpcGitRepoState } from "@pi-web/bridge/types";

/**
 * Merge a git repo's local + remote branches into a single list keyed by
 * short name. Locals win when a short name exists both locally and as
 * a remote-tracking branch. Order preserves the original `state.branches`
 * sequence.
 */
export function mergeBranchesFor(
  state: RpcGitRepoState | null,
): RpcGitBranch[] {
  if (!state) return [];
  const byShortName = new Map<
    string,
    { local?: RpcGitBranch; remotes: RpcGitBranch[] }
  >();
  for (const branch of state.branches) {
    const group = byShortName.get(branch.shortName) ?? { remotes: [] };
    if (branch.kind === "local") {
      group.local = branch;
    } else {
      group.remotes.push(branch);
    }
    byShortName.set(branch.shortName, group);
  }
  const result: RpcGitBranch[] = [];
  const seen = new Set<string>();
  for (const branch of state.branches) {
    const group = byShortName.get(branch.shortName);
    if (!group || seen.has(branch.shortName)) continue;
    seen.add(branch.shortName);
    if (group.local) {
      result.push(group.local);
    } else if (group.remotes.length > 0) {
      result.push(group.remotes[0]);
    }
  }
  return result;
}

/** Human-readable branch label: "origin/main" for remotes, "main" otherwise. */
export function branchDisplayName(branch: RpcGitBranch): string {
  if (branch.kind === "remote" && branch.remoteName) {
    return `${branch.remoteName}/${branch.shortName}`;
  }
  return branch.shortName;
}