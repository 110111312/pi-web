<script lang="ts">
  import type { Snippet } from "svelte";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import type {
    SessionEntry,
    WorkspaceSummary,
  } from "../composables/bridgeStore.svelte";
  import {
    CONTEXT_MENU_HEIGHT,
    CONTEXT_MENU_WIDTH,
    buildWorkspaceGroups,
    type ContextMenuState,
    type WorkspaceGroup,
  } from "./sessionRailUtils";
  import SessionRailWorkspaceGroup from "./SessionRailWorkspaceGroup.svelte";
  import SessionRailOlderModal from "./SessionRailOlderModal.svelte";
  import SessionRailContextMenu from "./SessionRailContextMenu.svelte";
  import "./sessionRail.css";

  let {
    workspaces = [] as readonly WorkspaceSummary[],
    workspaceSessions = {} as Readonly<Record<string, readonly SessionEntry[]>>,
    activeSessionPath = null as string | null,
    activeWorkspacePath = null as string | null,
    runningSessionPaths = [] as readonly string[],
    workspaceSessionLoaded = {} as Readonly<Record<string, boolean>>,
    workspaceSessionLoading = {} as Readonly<Record<string, boolean>>,
    workspaceSessionCursors = {} as Readonly<Record<string, string | null>>,
    onSelect = (_: string) => {},
    onDelete = (_: string) => {},
    onRename = (_: string, _name: string) => {},
    onNewSession = (_: string) => {},
    onExpandWorkspace = (_: string) => {},
    onLoadOlderSessions = (_: {
      workspacePath: string;
      cursor?: string | null;
    }) => {},
    headerActions,
  }: {
    workspaces?: readonly WorkspaceSummary[];
    workspaceSessions?: Readonly<Record<string, readonly SessionEntry[]>>;
    activeSessionPath?: string | null;
    activeWorkspacePath?: string | null;
    runningSessionPaths?: readonly string[];
    workspaceSessionLoaded?: Readonly<Record<string, boolean>>;
    workspaceSessionLoading?: Readonly<Record<string, boolean>>,
    workspaceSessionCursors?: Readonly<Record<string, string | null>>;
    onSelect?: (sessionPath: string) => void;
    onDelete?: (sessionPath: string) => void;
    onRename?: (sessionPath: string, name: string) => void;
    onNewSession?: (workspacePath: string) => void;
    onExpandWorkspace?: (workspacePath: string) => void;
    onLoadOlderSessions?: (payload: {
      workspacePath: string;
      cursor?: string | null;
    }) => void;
    headerActions?: Snippet;
  } = $props();

  let expandedWorkspaceIds = $state<Set<string>>(new Set());
  let activeOlderWorkspaceId = $state<string | null>(null);
  let workspaceQueries = $state<Record<string, string>>({});
  let lastAutoExpandedWorkspacePath: string | null = null;
  let menu = $state<ContextMenuState>({
    visible: false,
    sessionPath: null,
    x: 0,
    y: 0,
  });
  let workspacesRootExpanded = $state(true);

  let workspaceGroups = $derived.by((): WorkspaceGroup[] => {
    return buildWorkspaceGroups(
      workspaces,
      workspaceSessions,
      expandedWorkspaceIds,
      activeWorkspacePath,
      workspaceSessionLoaded,
      workspaceSessionLoading,
      workspaceQueries,
      workspaceSessionCursors,
    );
  });

  let activeOlderWorkspace = $derived(
    workspaceGroups.find(workspace => workspace.id === activeOlderWorkspaceId) ??
      null,
  );

  function expandWorkspace(workspaceId: string) {
    if (expandedWorkspaceIds.has(workspaceId)) return;
    expandedWorkspaceIds = new Set([...expandedWorkspaceIds, workspaceId]);
  }

  function toggleWorkspace(workspaceId: string) {
    const next = new Set(expandedWorkspaceIds);
    if (next.has(workspaceId)) next.delete(workspaceId);
    else next.add(workspaceId);
    expandedWorkspaceIds = next;
  }

  function openOlderSessions(workspaceId: string) {
    if (workspaceQueries[workspaceId] === undefined)
      workspaceQueries[workspaceId] = "";
    activeOlderWorkspaceId = workspaceId;
    const workspace = workspaceGroups.find(group => group.id === workspaceId);
    if (workspace?.nextCursor && workspace.remainingSessions.length === 0) {
      onLoadOlderSessions({
        workspacePath: workspace.path,
        cursor: workspace.nextCursor,
      });
    }
  }

  function loadMoreOlderSessions(workspace: WorkspaceGroup) {
    if (!workspace.nextCursor) return;
    onLoadOlderSessions({
      workspacePath: workspace.path,
      cursor: workspace.nextCursor,
    });
  }

  function closeOlderSessions() {
    activeOlderWorkspaceId = null;
    closeMenu();
  }

  function handleOlderSessionsOverlayClick(event: MouseEvent) {
    if (event.target !== event.currentTarget) return;
    closeOlderSessions();
  }

  function isSessionRunning(sessionPath: string): boolean {
    return runningSessionPaths.includes(sessionPath);
  }

  function openMenu(event: MouseEvent, sessionPath: string) {
    event.preventDefault();
    event.stopPropagation();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let x = event.clientX + 4;
    let y = event.clientY + 4;
    if (x + CONTEXT_MENU_WIDTH > viewportWidth)
      x = event.clientX - CONTEXT_MENU_WIDTH - 4;
    if (y + CONTEXT_MENU_HEIGHT > viewportHeight)
      y = event.clientY - CONTEXT_MENU_HEIGHT - 4;
    menu = { visible: true, sessionPath, x, y };
  }

  function closeMenu() {
    menu = { ...menu, visible: false };
  }

  function handleDelete(sessionPath: string) {
    closeMenu();
    if (!confirm("Delete this session? This cannot be undone.")) return;
    onDelete(sessionPath);
  }

  function findSessionName(sessionPath: string): string {
    for (const entries of Object.values(workspaceSessions)) {
      const session = entries.find(entry => entry.path === sessionPath);
      if (session) return session.name;
    }
    return "";
  }

  function handleRename(sessionPath: string) {
    closeMenu();
    const next = window.prompt("Rename session", findSessionName(sessionPath));
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    onRename(sessionPath, trimmed);
  }

  function handleSessionSelect(sessionPath: string, closeModal = false) {
    onSelect(sessionPath);
    if (closeModal) closeOlderSessions();
  }

  function handleWorkspaceNewSession(workspace: WorkspaceGroup) {
    closeMenu();
    onNewSession(workspace.path);
  }

  function handleOlderSearchInput(value: string) {
    if (!activeOlderWorkspaceId) return;
    workspaceQueries[activeOlderWorkspaceId] = value;
  }

  // Effects
  $effect(() => {
    workspaces.map(workspace => workspace.path).join(",");
    Object.values(workspaceSessions)
      .flat()
      .map(session => session.path)
      .join(",");
    queueMicrotask(closeMenu);
  });

  $effect(() => {
    const activeWorkspace = activeWorkspacePath
      ? workspaceGroups.find(
          workspace => workspace.path === activeWorkspacePath,
        )
      : null;

    if (!activeWorkspace) {
      lastAutoExpandedWorkspacePath = null;
      return;
    }

    workspacesRootExpanded = true;
    if (activeWorkspace.path === lastAutoExpandedWorkspacePath) return;
    lastAutoExpandedWorkspacePath = activeWorkspace.path;
    expandWorkspace(activeWorkspace.id);
  });

  $effect(() => {
    for (const workspace of workspaceGroups) {
      if (
        !workspace.isExpanded ||
        workspace.isLoaded ||
        workspace.isLoading
      )
        continue;
      onExpandWorkspace(workspace.path);
    }
  });
</script>

<div
  class="session-rail"
  role="button"
  tabindex="0"
  onclick={closeMenu}
  onkeydown={(event) =>
    (event.key === "Enter" || event.key === " ") && closeMenu()}
>
  <div class="rail-list">
    <section
      class="workspace-root"
      class:expanded={workspacesRootExpanded}
    >
      <div class="workspace-row workspace-root-row">
        <div class="workspace-root-chip">
          <button
            class="workspace-toggle workspace-root-toggle"
            type="button"
            aria-expanded={workspacesRootExpanded}
            aria-label={workspacesRootExpanded
              ? "Collapse workspaces"
              : "Expand workspaces"}
            onclick={() =>
              (workspacesRootExpanded = !workspacesRootExpanded)}
            onpointerup={(event) => {
              if (event.currentTarget instanceof HTMLButtonElement) {
                event.currentTarget.blur();
              }
            }}
          >
            {#if workspacesRootExpanded}
              <ChevronDown
                aria-hidden="true"
                size={16}
                color="var(--text-subtle)"
                style="display: block; flex-shrink: 0;"
              />
            {:else}
              <ChevronRight
                aria-hidden="true"
                size={16}
                color="var(--text-subtle)"
                style="display: block; flex-shrink: 0;"
              />
            {/if}
            <span class="workspace-copy workspace-root-copy">
              <span class="workspace-root-label">Workspaces</span>
            </span>
          </button>
          <div class="rail-actions">
            {#if headerActions}
              {@render headerActions()}
            {/if}
          </div>
        </div>
      </div>

      {#if workspacesRootExpanded}
        {#if workspaceGroups.length > 0}
          <div class="workspace-tree">
            {#each workspaceGroups as workspace (workspace.id)}
              <SessionRailWorkspaceGroup
                {workspace}
                {activeSessionPath}
                {isSessionRunning}
                onToggleWorkspace={toggleWorkspace}
                onNewSession={handleWorkspaceNewSession}
                onSelectSession={(sessionPath) =>
                  handleSessionSelect(sessionPath)}
                onContextMenu={openMenu}
                onOpenOlderSessions={openOlderSessions}
              />
            {/each}
          </div>
        {:else}
          <p class="rail-empty nested">No workspaces</p>
        {/if}
      {/if}
    </section>
  </div>
</div>

{#if activeOlderWorkspace}
  <SessionRailOlderModal
    workspace={activeOlderWorkspace}
    {activeSessionPath}
    {isSessionRunning}
    onClose={closeOlderSessions}
    onOverlayClick={handleOlderSessionsOverlayClick}
    onOverlayKeydown={(event) => {
      if (event.key === "Escape") closeOlderSessions();
      else if (event.key === "Enter" || event.key === " ")
        handleOlderSessionsOverlayClick(
          event as unknown as MouseEvent,
        );
    }}
    onSearchInput={handleOlderSearchInput}
    onSelectSession={(sessionPath) =>
      handleSessionSelect(sessionPath, true)}
    onContextMenu={openMenu}
    onLoadMore={loadMoreOlderSessions}
  />
{/if}

{#if menu.visible}
  <SessionRailContextMenu
    {menu}
    onClose={closeMenu}
    onRename={handleRename}
    onDelete={handleDelete}
  />
{/if}