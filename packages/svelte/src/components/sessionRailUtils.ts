import type { SessionEntry } from "../composables/bridgeStore.svelte";

/** Default UI constants for the session rail. */
export const RECENT_SESSION_LIMIT = 5;
export const CONTEXT_MENU_WIDTH = 136;
export const CONTEXT_MENU_HEIGHT = 88;
export const WORKSPACE_FOLDER_ICON_SIZE = 14;
export const WORKSPACE_FOLDER_ICON_STYLE =
  "display: block; flex-shrink: 0;";

/**
 * Numeric activity value used to sort sessions newest-first.
 *
 * Prefers `updatedAt` and falls back to `timestamp`. Returns
 * `-Infinity` for unparseable values so they sort last.
 */
export function sessionActivityValue(session: SessionEntry): number {
  const parsed = Date.parse(session.updatedAt ?? session.timestamp ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/** Sort comparator: newest activity first, ties broken by reverse path. */
export function compareSessionsByActivity(
  left: SessionEntry,
  right: SessionEntry,
): number {
  const activityDelta = sessionActivityValue(right) - sessionActivityValue(left);
  if (activityDelta !== 0) return activityDelta;
  return right.path.localeCompare(left.path);
}

/** Case-insensitive substring match against the session's display fields. */
export function sessionMatchesQuery(
  session: SessionEntry,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [
    session.name,
    session.path,
    session.workspaceName,
    session.workspacePath,
  ]
    .filter((value): value is string => typeof value === "string")
    .some(value => value.toLowerCase().includes(normalizedQuery));
}

/** View-model for a single workspace section in the rail. */
export interface WorkspaceGroup {
  id: string;
  name: string;
  path: string;
  sessions: SessionEntry[];
  isExpanded: boolean;
  isActive: boolean;
  isLoaded: boolean;
  isLoading: boolean;
  query: string;
  recentSessions: SessionEntry[];
  remainingSessions: SessionEntry[];
  filteredRemainingSessions: SessionEntry[];
  nextCursor: string | null;
}

/** Floating context-menu state (right-click on a session item). */
export interface ContextMenuState {
  visible: boolean;
  sessionPath: string | null;
  x: number;
  y: number;
}

/** Build the per-workspace view-models consumed by the rail template. */
export function buildWorkspaceGroups(
  workspaces: readonly import("../composables/bridgeStore.svelte").WorkspaceSummary[],
  workspaceSessions: Readonly<Record<string, readonly SessionEntry[]>>,
  expandedIds: ReadonlySet<string>,
  activeWorkspacePath: string | null,
  workspaceSessionLoaded: Readonly<Record<string, boolean>>,
  workspaceSessionLoading: Readonly<Record<string, boolean>>,
  workspaceQueries: Readonly<Record<string, string>>,
  workspaceSessionCursors: Readonly<Record<string, string | null>>,
): WorkspaceGroup[] {
  return workspaces.map(workspace => {
    const groupSessions = [...(workspaceSessions[workspace.path] ?? [])].sort(
      compareSessionsByActivity,
    );
    const query = workspaceQueries[workspace.id] ?? "";
    const remainingSessions = groupSessions.slice(RECENT_SESSION_LIMIT);
    return {
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
      sessions: groupSessions,
      isExpanded: expandedIds.has(workspace.id),
      isActive: workspace.path === activeWorkspacePath,
      isLoaded: workspaceSessionLoaded[workspace.path] === true,
      isLoading: workspaceSessionLoading[workspace.path] === true,
      query,
      recentSessions: groupSessions.slice(0, RECENT_SESSION_LIMIT),
      remainingSessions,
      filteredRemainingSessions: remainingSessions.filter(s =>
        sessionMatchesQuery(s, query),
      ),
      nextCursor: workspaceSessionCursors[workspace.path] ?? null,
    };
  });
}