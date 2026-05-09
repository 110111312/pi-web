<script lang="ts">
  import type { Snippet } from "svelte";
  import Folder from "lucide-svelte/icons/folder";
  import FolderOpen from "lucide-svelte/icons/folder-open";
  import Pencil from "lucide-svelte/icons/pencil";
  import Plus from "lucide-svelte/icons/plus";
  import Search from "lucide-svelte/icons/search";
  import Trash2 from "lucide-svelte/icons/trash-2";
  import type { SessionEntry } from "../composables/bridgeStore.svelte";

  let {
    sessions = [] as readonly SessionEntry[],
    activeSessionPath = null as string | null,
    runningSessionPaths = [] as readonly string[],
    workspaceSessionCursors = {} as Readonly<Record<string, string | null>>,
    onSelect = (_: string) => {},
    onRename = (_: { sessionPath: string; name: string }) => {},
    onDelete = (_: string) => {},
    onNewSession = (_: string) => {},
    onLoadOlderSessions = (_: {
      workspacePath: string;
      cursor?: string | null;
    }) => {},
    headerActions,
  }: {
    sessions?: readonly SessionEntry[];
    activeSessionPath?: string | null;
    runningSessionPaths?: readonly string[];
    workspaceSessionCursors?: Readonly<Record<string, string | null>>;
    onSelect?: (sessionPath: string) => void;
    onRename?: (payload: { sessionPath: string; name: string }) => void;
    onDelete?: (sessionPath: string) => void;
    onNewSession?: (workspacePath: string) => void;
    onLoadOlderSessions?: (payload: {
      workspacePath: string;
      cursor?: string | null;
    }) => void;
    headerActions?: Snippet;
  } = $props();

  const RECENT_SESSION_LIMIT = 5;
  const UNKNOWN_WORKSPACE_ID = "unknown-workspace";
  const MENU_WIDTH = 136;
  const MENU_HEIGHT = 80;
  const WORKSPACE_FOLDER_ICON_SIZE = 15;
  const WORKSPACE_FOLDER_ICON_STYLE = "display: block; flex-shrink: 0;";

  interface WorkspaceGroup {
    id: string;
    name: string;
    path: string;
    sessions: SessionEntry[];
    actualSessions: SessionEntry[];
    latestActivity: number;
    isExpanded: boolean;
    isActive: boolean;
    query: string;
    recentSessions: SessionEntry[];
    remainingSessions: SessionEntry[];
    filteredRemainingSessions: SessionEntry[];
    nextCursor: string | null;
  }

  interface MenuState {
    visible: boolean;
    sessionPath: string | null;
    x: number;
    y: number;
  }

  let expandedWorkspaceIds = $state<Set<string>>(new Set());
  let activeOlderWorkspaceId = $state<string | null>(null);
  let workspaceQueries = $state<Record<string, string>>({});
  let editingPath = $state<string | null>(null);
  let editingName = $state("");
  let editInputRef = $state<HTMLInputElement | null>(null);
  let lastAutoExpandedSessionPath: string | null = null;
  let hasAutoExpandedInitialWorkspace = false;
  let menu = $state<MenuState>({
    visible: false,
    sessionPath: null,
    x: 0,
    y: 0,
  });

  function sessionActivityValue(session: SessionEntry): number {
    if (session.isWorkspacePlaceholder) return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(session.updatedAt ?? session.timestamp ?? "");
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }

  function workspaceFromSessionPath(sessionPath: string): {
    id: string;
    name: string;
    path: string;
  } | null {
    const match = /[\\/]\.pi[\\/]agent[\\/]sessions[\\/]([^\\/]+)[\\/]/.exec(
      sessionPath,
    );
    const encoded = match?.[1];
    if (!encoded) return null;
    const stripped = encoded.replace(/^--/, "").replace(/--$/, "");
    const homeMatch = /^home-([^-]+)-(.+)$/.exec(stripped);
    if (homeMatch) {
      const [, user, workspaceName] = homeMatch;
      const wp = `/home/${user}/${workspaceName}`;
      return { id: wp, name: workspaceName, path: wp };
    }
    return { id: encoded, name: stripped || encoded, path: stripped || encoded };
  }

  function getWorkspaceId(session: SessionEntry): string {
    return (
      session.workspaceId ??
      session.workspacePath ??
      workspaceFromSessionPath(session.path)?.id ??
      UNKNOWN_WORKSPACE_ID
    );
  }

  function getWorkspacePath(session: SessionEntry): string {
    return (
      session.workspacePath ??
      workspaceFromSessionPath(session.path)?.path ??
      "Unknown workspace"
    );
  }

  function getWorkspaceName(session: SessionEntry): string {
    if (session.workspaceName) return session.workspaceName;
    const fb = workspaceFromSessionPath(session.path);
    if (fb) return fb.name;
    const wp = getWorkspacePath(session);
    const parts = wp.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) ?? wp;
  }

  function compareSessionsByActivity(
    left: SessionEntry,
    right: SessionEntry,
  ): number {
    const ad = sessionActivityValue(right) - sessionActivityValue(left);
    if (ad !== 0) return ad;
    return right.path.localeCompare(left.path);
  }

  function sessionMatchesQuery(session: SessionEntry, query: string): boolean {
    const nq = query.trim().toLowerCase();
    if (!nq) return true;
    return [
      session.name,
      session.path,
      session.workspaceName,
      session.workspacePath,
    ]
      .filter((v): v is string => typeof v === "string")
      .some(v => v.toLowerCase().includes(nq));
  }

  let workspaceGroups = $derived.by((): WorkspaceGroup[] => {
    const groups = new Map<
      string,
      {
        id: string;
        name: string;
        path: string;
        sessions: SessionEntry[];
        latestActivity: number;
      }
    >();

    for (const s of sessions) {
      const id = getWorkspaceId(s);
      const existing = groups.get(id);
      const activity = sessionActivityValue(s);
      if (existing) {
        existing.sessions.push(s);
        existing.latestActivity = Math.max(existing.latestActivity, activity);
      } else {
        groups.set(id, {
          id,
          name: getWorkspaceName(s),
          path: getWorkspacePath(s),
          sessions: [s],
          latestActivity: activity,
        });
      }
    }

    return Array.from(groups.values())
      .map(group => {
        const groupSessions = [...group.sessions].sort(compareSessionsByActivity);
        const actualSessions = groupSessions.filter(s => !s.isWorkspacePlaceholder);
        const query = workspaceQueries[group.id] ?? "";
        const remaining = actualSessions.slice(RECENT_SESSION_LIMIT);
        const nextCursor = workspaceSessionCursors[group.path] ?? null;

        return {
          ...group,
          sessions: groupSessions,
          actualSessions,
          isExpanded: expandedWorkspaceIds.has(group.id),
          isActive: actualSessions.some(s => s.path === activeSessionPath),
          query,
          recentSessions: actualSessions.slice(0, RECENT_SESSION_LIMIT),
          remainingSessions: remaining,
          filteredRemainingSessions: remaining.filter(s => sessionMatchesQuery(s, query)),
          nextCursor,
        };
      })
      .sort((a, b) => {
        const ad = b.latestActivity - a.latestActivity;
        if (ad !== 0) return ad;
        return a.name.localeCompare(b.name);
      });
  });

  let activeOlderWorkspace = $derived(
    workspaceGroups.find(w => w.id === activeOlderWorkspaceId) ?? null,
  );

  let menuPanelStyle = $derived(`left: ${menu.x}px; top: ${menu.y}px`);

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
    if (workspaceQueries[workspaceId] === undefined) workspaceQueries[workspaceId] = "";
    activeOlderWorkspaceId = workspaceId;
    const ws = workspaceGroups.find(g => g.id === workspaceId);
    if (ws?.nextCursor && ws.remainingSessions.length === 0) {
      onLoadOlderSessions({ workspacePath: ws.path, cursor: ws.nextCursor });
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
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = event.clientX + 4;
    let y = event.clientY + 4;
    if (x + MENU_WIDTH > vw) x = event.clientX - MENU_WIDTH - 4;
    if (y + MENU_HEIGHT > vh) y = event.clientY - MENU_HEIGHT - 4;
    menu = { visible: true, sessionPath, x, y };
  }

  function closeMenu() {
    menu = { ...menu, visible: false };
  }

  function startRename(sessionPath: string) {
    const session = sessions.find(s => s.path === sessionPath);
    if (!session) return;
    editingPath = sessionPath;
    editingName = session.name;
    closeMenu();
    queueMicrotask(() => {
      editInputRef?.focus();
      editInputRef?.select();
    });
  }

  function confirmRename() {
    const name = editingName.trim();
    if (editingPath && name) {
      onRename({ sessionPath: editingPath, name });
    }
    editingPath = null;
    editingName = "";
  }

  function cancelRename() {
    editingPath = null;
    editingName = "";
  }

  function handleDelete(sessionPath: string) {
    closeMenu();
    if (!confirm("Delete this session? This cannot be undone.")) return;
    onDelete(sessionPath);
  }

  function handleSessionSelect(sessionPath: string, closeModal = false) {
    if (editingPath === sessionPath) return;
    onSelect(sessionPath);
    if (closeModal) closeOlderSessions();
  }

  function handleWorkspaceNewSession(workspace: WorkspaceGroup) {
    if (workspace.path === "Unknown workspace") return;
    closeMenu();
    onNewSession(workspace.path);
  }

  // Effects
  $effect(() => {
    sessions.map(s => s.path).join(",");
    queueMicrotask(closeMenu);
  });

  $effect(() => {
    const as = activeSessionPath
      ? sessions.find(s => s.path === activeSessionPath)
      : undefined;

    if (as) {
      hasAutoExpandedInitialWorkspace = true;
      if (as.path === lastAutoExpandedSessionPath) return;
      lastAutoExpandedSessionPath = as.path;
      expandWorkspace(getWorkspaceId(as));
      return;
    }

    lastAutoExpandedSessionPath = null;
    if (sessions.length > 0 && !hasAutoExpandedInitialWorkspace) {
      hasAutoExpandedInitialWorkspace = true;
      expandWorkspace(getWorkspaceId(sessions[0]));
    }
  });
</script>

<div class="session-rail" onclick={closeMenu}>
  <div class="rail-header">
    <span class="rail-title">Workspaces</span>
    <div class="rail-actions">
      {#if headerActions}
        {@render headerActions()}
      {/if}
    </div>
  </div>

  {#if workspaceGroups.length > 0}
    <div class="rail-list">
      {#each workspaceGroups as workspace (workspace.id)}
        <section
          class="workspace-group"
          class:expanded={workspace.isExpanded}
          class:active={workspace.isActive}
        >
          <div class="workspace-row" title={workspace.path}>
            <button
              class="workspace-toggle"
              type="button"
              aria-expanded={workspace.isExpanded}
              onclick={() => toggleWorkspace(workspace.id)}
            >
              {#if workspace.isExpanded}
                <FolderOpen
                  class="workspace-icon"
                  aria-hidden="true"
                  size={WORKSPACE_FOLDER_ICON_SIZE}
                  color="var(--text-subtle)"
                  style={WORKSPACE_FOLDER_ICON_STYLE}
                />
              {:else}
                <Folder
                  class="workspace-icon"
                  aria-hidden="true"
                  size={WORKSPACE_FOLDER_ICON_SIZE}
                  color="var(--text-subtle)"
                  style={WORKSPACE_FOLDER_ICON_STYLE}
                />
              {/if}
              <span class="workspace-copy">
                <span class="workspace-name">{workspace.name}</span>
                <span class="workspace-path">{workspace.path}</span>
              </span>
            </button>
            <button
              class="workspace-new-session"
              type="button"
              aria-label={`New session in ${workspace.name}`}
              title={`New session in ${workspace.path}`}
              onclick={(e) => {
                e.stopPropagation();
                handleWorkspaceNewSession(workspace);
              }}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          </div>

          {#if workspace.isExpanded}
            <div class="session-list">
              {#if workspace.actualSessions.length === 0}
                <p class="workspace-empty">No sessions yet</p>
              {/if}
              {#each workspace.recentSessions as s (s.path)}
                <div
                  class="rail-item"
                  role="button"
                  tabindex="0"
                  class:active={s.path === activeSessionPath}
                  class:running={isSessionRunning(s.path)}
                  onclick={() => handleSessionSelect(s.path)}
                  onkeydown={(e) => e.key === "Enter" && handleSessionSelect(s.path)}
                  oncontextmenu={(e) => openMenu(e, s.path)}
                >
                  <span class="item-indicator"></span>
                  {#if editingPath === s.path}
                    <input
                      bind:this={editInputRef}
                      bind:value={editingName}
                      class="item-input"
                      type="text"
                      onkeydown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); confirmRename(); }
                        if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                      }}
                      onblur={confirmRename}
                      onclick={(e) => e.stopPropagation()}
                    />
                  {:else}
                    <span class="item-label">{s.name}</span>
                  {/if}
                  {#if isSessionRunning(s.path)}
                    <span class="item-status" role="status" aria-label="Agent running" title="Agent running">
                      <span class="item-status-dot" aria-hidden="true"></span>
                    </span>
                  {/if}
                </div>
              {/each}

              {#if workspace.remainingSessions.length > 0 || workspace.nextCursor}
                <div class="older-sessions">
                  <button
                    class="older-toggle"
                    type="button"
                    aria-haspopup="dialog"
                    onclick={() => openOlderSessions(workspace.id)}
                  >
                    <span>Browse older sessions</span>
                  </button>
                </div>
              {/if}
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {:else}
    <p class="rail-empty">No workspaces</p>
  {/if}
</div>

{#if activeOlderWorkspace}
  <div
    class="older-modal-overlay"
    onclick={handleOlderSessionsOverlayClick}
    onkeydown={(e) => e.key === "Escape" && closeOlderSessions()}
  >
    <section
      class="older-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`${activeOlderWorkspace.name} older sessions`}
    >
      <label class="modal-session-search">
        <Search size={16} aria-hidden="true" />
        <input
          bind:value={workspaceQueries[activeOlderWorkspace.id]}
          type="search"
          autocomplete="off"
          spellcheck="false"
          placeholder="Search older sessions"
          autofocus
        />
      </label>

      <div class="older-modal-list">
        {#each activeOlderWorkspace.filteredRemainingSessions as s (s.path)}
          <div
            class="modal-session-item"
            role="button"
            tabindex="0"
            class:active={s.path === activeSessionPath}
            class:running={isSessionRunning(s.path)}
            onclick={() => handleSessionSelect(s.path, true)}
            onkeydown={(e) => e.key === "Enter" && handleSessionSelect(s.path, true)}
            oncontextmenu={(e) => openMenu(e, s.path)}
          >
            <span class="item-indicator"></span>
            <span class="modal-session-copy">
              {#if editingPath === s.path}
                <input
                  bind:this={editInputRef}
                  bind:value={editingName}
                  class="item-input modal-item-input"
                  type="text"
                  onkeydown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); confirmRename(); }
                    if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                  }}
                  onblur={confirmRename}
                  onclick={(e) => e.stopPropagation()}
                />
              {:else}
                <span class="modal-session-name">{s.name}</span>
              {/if}
            </span>
            {#if isSessionRunning(s.path)}
              <span class="item-status" role="status" aria-label="Agent running" title="Agent running">
                <span class="item-status-dot" aria-hidden="true"></span>
              </span>
            {/if}
          </div>
        {/each}

        {#if activeOlderWorkspace.nextCursor}
          <button
            class="modal-load-more"
            type="button"
            onclick={() => loadMoreOlderSessions(activeOlderWorkspace!)}
          >
            Load more
          </button>
        {/if}

        {#if activeOlderWorkspace.filteredRemainingSessions.length === 0}
          <p class="modal-empty">No matching sessions</p>
        {/if}
      </div>
    </section>
  </div>
{/if}

{#if menu.visible}
  <div
    class="menu-overlay"
    onclick={closeMenu}
    oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); }}
  >
    <div class="menu-panel show" style={menuPanelStyle} onclick={(e) => e.stopPropagation()}>
      <button
        class="menu-item"
        type="button"
        onclick={() => menu.sessionPath && startRename(menu.sessionPath)}
      >
        <Pencil class="menu-icon" aria-hidden="true" size={13} />
        <span>Rename</span>
      </button>
      <div class="menu-divider"></div>
      <button
        class="menu-item danger"
        type="button"
        onclick={() => menu.sessionPath && handleDelete(menu.sessionPath)}
      >
        <Trash2 class="menu-icon" aria-hidden="true" size={13} />
        <span>Delete</span>
      </button>
    </div>
  </div>
{/if}

<style>
  .session-rail {
    display: flex;
    flex-direction: column;
    padding: 0px 4px 0;
    overflow: hidden;
    position: relative;
  }

  .rail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 44px;
    padding: 6px 4px 10px 8px;
    color: var(--text-subtle);
    flex-shrink: 0;
  }

  .rail-title {
    font-size: 0.64rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .rail-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .rail-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    margin-right: -8px;
    padding: 0 14px 8px 0;
    scrollbar-gutter: auto;
    scrollbar-width: none;
  }

  .rail-list::-webkit-scrollbar {
    display: none;
  }

  .workspace-group {
    border-radius: 10px;
  }

  .workspace-toggle,
  .rail-item,
  .older-toggle {
    width: 100%;
    border: 0;
    font: inherit;
    text-align: left;
  }

  .workspace-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 42px;
    padding: 4px 6px 4px 8px;
    border-radius: 10px;
    background: transparent;
    color: var(--text-muted);
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }

  .workspace-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    align-self: stretch;
    padding: 2px 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .workspace-row:hover,
  .workspace-row:focus-within {
    background: var(--surface-hover);
    color: var(--text);
  }

  .workspace-icon {
    width: 14px;
    height: 14px;
    color: var(--text-subtle);
    flex-shrink: 0;
  }

  .workspace-copy {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .workspace-name,
  .workspace-path,
  .item-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-name {
    font-size: 0.84rem;
    font-weight: 600;
  }

  .workspace-path {
    font-size: 0.68rem;
    color: var(--text-subtle);
  }

  .workspace-new-session {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text-subtle);
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transform: translateX(2px) scale(0.96);
    transition:
      background 0.14s ease,
      box-shadow 0.14s ease,
      color 0.14s ease,
      opacity 0.14s ease,
      transform 0.14s ease;
  }

  .workspace-row:hover .workspace-new-session,
  .workspace-row:focus-within .workspace-new-session {
    opacity: 1;
    transform: translateX(0) scale(1);
  }

  .workspace-new-session:hover {
    background: var(--surface-hover);
    color: var(--text-muted);
  }

  .session-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 0 6px 20px;
  }

  .workspace-empty {
    margin: 0;
    padding: 6px 10px;
    font-size: 0.76rem;
    color: var(--text-subtle);
  }

  .rail-item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 10px;
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.82rem;
    position: relative;
    user-select: none;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }

  .rail-item:hover {
    background: var(--surface-hover);
  }

  .rail-item.active {
    background: var(--surface-selected);
    color: var(--text);
  }

  .item-indicator {
    position: absolute;
    left: 4px;
    top: 50%;
    width: 2px;
    height: 14px;
    border-radius: 999px;
    background: transparent;
    transform: translateY(-50%);
    flex-shrink: 0;
  }

  .rail-item.active .item-indicator {
    background: var(--text);
  }

  .rail-item.running .item-indicator {
    background: var(--accent);
  }

  .item-label {
    flex: 1 1 auto;
    min-width: 0;
  }

  .item-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--panel);
    color: var(--text);
    font: inherit;
    font-size: 0.82rem;
    outline: none;
  }

  .item-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .item-status {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .item-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--accent);
    animation: session-running-blink 1.1s ease-in-out infinite;
  }

  .older-sessions {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 2px;
  }

  .older-toggle {
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    background: transparent;
    color: var(--text-subtle);
    cursor: pointer;
    font-size: 0.74rem;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }

  .older-toggle:hover {
    background: var(--surface-hover);
    color: var(--text-muted);
  }

  .rail-empty {
    margin: 0;
    padding: 8px 10px;
    font-size: 0.78rem;
    color: var(--text-subtle);
  }

  .older-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--overlay);
  }

  .older-modal {
    width: min(720px, 100%);
    max-height: min(720px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: 16px;
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow: var(--shadow-floating);
  }

  .modal-session-search {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 52px;
    margin: 18px;
    padding: 0 16px;
    border: 1px solid var(--border);
    border-radius: 14px;
    color: var(--text-subtle);
    background: var(--panel);
  }

  .modal-session-search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .modal-session-search input {
    width: 100%;
    min-width: 0;
    height: 40px;
    border: 0;
    outline: 0;
    padding: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 1rem;
  }

  .modal-session-search input::placeholder {
    color: var(--text-subtle);
  }

  .older-modal-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-height: 0;
    overflow-y: auto;
    padding: 0 14px 12px;
  }

  .modal-session-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    padding: 3px 10px;
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font: inherit;
    text-align: left;
    user-select: none;
  }

  .modal-session-item:hover {
    background: var(--surface-hover);
  }

  .modal-session-item.active {
    background: var(--surface-selected);
    color: var(--text);
  }

  .modal-session-item.running .item-indicator {
    background: var(--accent);
  }

  .modal-session-copy {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .modal-session-name {
    overflow: hidden;
    font-size: 0.82rem;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .modal-item-input {
    width: 100%;
    flex: 0 0 auto;
    font-size: 0.86rem;
  }

  .modal-load-more {
    margin: 8px 10px 2px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel-2);
    color: var(--text-muted);
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
  }

  .modal-load-more:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .modal-empty {
    margin: 0;
    padding: 18px 10px;
    color: var(--text-subtle);
    font-size: 0.84rem;
  }

  .menu-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: transparent;
  }

  .menu-panel {
    position: fixed;
    min-width: 136px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel-2) 98%, white 2%);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--border) 50%, transparent),
      var(--shadow-raised);
    display: flex;
    flex-direction: column;
    gap: 1px;
    opacity: 0;
    transform: scale(0.96);
    transition:
      opacity 0.1s ease,
      transform 0.1s ease;
    pointer-events: auto;
  }

  .menu-panel.show {
    opacity: 1;
    transform: scale(1);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.78rem;
    cursor: pointer;
    text-align: left;
    transition:
      background 0.1s ease,
      color 0.1s ease;
  }

  .menu-item:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .menu-item.danger:hover {
    background: var(--error-bg);
    color: var(--error-text);
  }

  .menu-icon {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .menu-item:hover .menu-icon {
    opacity: 1;
  }

  .menu-divider {
    height: 1px;
    margin: 1px 6px;
    background: var(--border);
    opacity: 0.6;
  }

  @keyframes session-running-blink {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.38;
      transform: scale(0.86);
    }
  }


  @media (max-width: 700px) {
    .older-modal-overlay {
      align-items: stretch;
      padding: 8px;
    }

    .older-modal {
      width: 100%;
      max-height: calc(100vh - 16px);
      border-radius: 14px;
    }

    .modal-session-search {
      height: 46px;
      margin: 14px;
      padding: 0 12px;
      gap: 10px;
      border-radius: 12px;
    }

    .modal-session-search input {
      height: 36px;
      font-size: 0.95rem;
    }

    .modal-session-item {
      align-items: flex-start;
      gap: 8px;
      min-height: 0;
      padding: 8px 10px;
    }

    .modal-session-name {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      white-space: normal;
      overflow-wrap: anywhere;
    }
  }
</style>
