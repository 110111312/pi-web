<script lang="ts">
  import Search from "lucide-svelte/icons/search";
  import type { WorkspaceGroup } from "./sessionRailUtils";

  let {
    workspace,
    activeSessionPath,
    isSessionRunning,
    onClose,
    onOverlayClick,
    onOverlayKeydown,
    onSearchInput,
    onSelectSession,
    onContextMenu,
    onLoadMore,
  } = $props<{
    workspace: WorkspaceGroup;
    activeSessionPath: string | null;
    isSessionRunning: (sessionPath: string) => boolean;
    onClose: () => void;
    onOverlayClick: (event: MouseEvent) => void;
    onOverlayKeydown: (event: KeyboardEvent) => void;
    onSearchInput: (value: string) => void;
    onSelectSession: (sessionPath: string) => void;
    onContextMenu: (event: MouseEvent, sessionPath: string) => void;
    onLoadMore: (workspace: WorkspaceGroup) => void;
  }>();
</script>

<div
  class="older-modal-overlay"
  role="button"
  tabindex="0"
  onclick={onOverlayClick}
  onkeydown={onOverlayKeydown}
>
  <div
    class="older-modal"
    role="dialog"
    aria-modal="true"
    aria-label={`${workspace.name} older sessions`}
  >
    <label class="modal-session-search">
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        autocomplete="off"
        spellcheck="false"
        placeholder="Search older sessions"
        value={workspace.query}
        oninput={(event) =>
          onSearchInput((event.currentTarget as HTMLInputElement).value)}
      />
    </label>

    <div class="older-modal-list">
      {#each workspace.filteredRemainingSessions as session (session.path)}
        <div
          class="modal-session-item"
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
          <span class="modal-session-copy">
            <span class="modal-session-name">{session.name}</span>
          </span>
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

      {#if workspace.nextCursor}
        <button
          class="modal-load-more"
          type="button"
          disabled={workspace.isLoading}
          onclick={() => onLoadMore(workspace)}
        >
          {workspace.isLoading ? "Loading..." : "Load more"}
        </button>
      {/if}

      {#if !workspace.isLoading && workspace.filteredRemainingSessions.length === 0}
        <p class="modal-empty">No matching sessions</p>
      {/if}
    </div>
  </div>
</div>