<script lang="ts">
  import Folder from "lucide-svelte/icons/folder";
  import FolderOpen from "lucide-svelte/icons/folder-open";
  import Plus from "lucide-svelte/icons/plus";
  import {
    WORKSPACE_FOLDER_ICON_SIZE,
    WORKSPACE_FOLDER_ICON_STYLE,
    type WorkspaceGroup,
  } from "./sessionRailUtils";

  let {
    workspace,
    activeSessionPath,
    isSessionRunning,
    onToggleWorkspace,
    onNewSession,
    onSelectSession,
    onContextMenu,
    onOpenOlderSessions,
  } = $props<{
    workspace: WorkspaceGroup;
    activeSessionPath: string | null;
    isSessionRunning: (sessionPath: string) => boolean;
    onToggleWorkspace: (workspaceId: string) => void;
    onNewSession: (workspace: WorkspaceGroup) => void;
    onSelectSession: (sessionPath: string) => void;
    onContextMenu: (event: MouseEvent, sessionPath: string) => void;
    onOpenOlderSessions: (workspaceId: string) => void;
  }>();
</script>

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
      onclick={() => onToggleWorkspace(workspace.id)}
    >
      {#if workspace.isExpanded}
        <FolderOpen
          aria-hidden="true"
          size={WORKSPACE_FOLDER_ICON_SIZE}
          color="var(--text-subtle)"
          style={WORKSPACE_FOLDER_ICON_STYLE}
        />
      {:else}
        <Folder
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
      onclick={(event) => {
        event.stopPropagation();
        onNewSession(workspace);
      }}
    >
      <Plus size={14} aria-hidden="true" />
    </button>
  </div>

  {#if workspace.isExpanded}
    <div class="session-list">
      {#if !workspace.isLoaded}
        <p class="workspace-empty">Loading sessions...</p>
      {:else if workspace.sessions.length === 0}
        <p class="workspace-empty">No sessions yet</p>
      {/if}

      {#each workspace.recentSessions as session (session.path)}
        <div
          class="rail-item"
          role="button"
          tabindex="0"
          class:active={session.path === activeSessionPath}
          class:running={isSessionRunning(session.path)}
          onclick={() => onSelectSession(session.path)}
          onkeydown={(event) =>
            event.key === "Enter" && onSelectSession(session.path)}
          oncontextmenu={(event) => onContextMenu(event, session.path)}
        >
          <span class="item-indicator"></span>
          <span class="item-label">{session.name}</span>
          {#if isSessionRunning(session.path)}
            <span
              class="item-status"
              role="status"
              aria-label="Agent running"
              title="Agent running"
            >
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
            onclick={() => onOpenOlderSessions(workspace.id)}
          >
            <span>Browse older sessions</span>
          </button>
        </div>
      {/if}
    </div>
  {/if}
</section>