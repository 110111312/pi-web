<script setup lang="ts">
import {
  Folder,
  FolderOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-vue-next";
import { computed, nextTick, ref, watch } from "vue";
import type { SessionEntry } from "../composables/useBridgeClient";

const props = defineProps<{
  sessions: readonly SessionEntry[];
  activeSessionPath: string | null;
  runningSessionPaths: readonly string[];
  workspaceSessionCursors: Readonly<Record<string, string | null>>;
}>();

const emit = defineEmits<{
  select: [sessionPath: string];
  rename: [payload: { sessionPath: string; name: string }];
  delete: [sessionPath: string];
  newSession: [workspacePath: string];
  loadOlderSessions: [
    payload: { workspacePath: string; cursor?: string | null },
  ];
}>();

const RECENT_SESSION_LIMIT = 5;
const UNKNOWN_WORKSPACE_ID = "unknown-workspace";
const MENU_WIDTH = 136;
const MENU_HEIGHT = 80;

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

const expandedWorkspaceIds = ref<Set<string>>(new Set());
const activeOlderWorkspaceId = ref<string | null>(null);
const workspaceQueries = ref<Record<string, string>>({});
const editingPath = ref<string | null>(null);
const editingName = ref("");
const editInputRef = ref<HTMLInputElement | null>(null);
const menu = ref<MenuState>({
  visible: false,
  sessionPath: null,
  x: 0,
  y: 0,
});

function sessionActivityValue(session: SessionEntry): number {
  if (session.isWorkspacePlaceholder) {
    return Number.NEGATIVE_INFINITY;
  }
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
    const workspacePath = `/home/${user}/${workspaceName}`;
    return { id: workspacePath, name: workspaceName, path: workspacePath };
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
  const fallbackWorkspace = workspaceFromSessionPath(session.path);
  if (fallbackWorkspace) return fallbackWorkspace.name;
  const workspacePath = getWorkspacePath(session);
  const parts = workspacePath.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? workspacePath;
}

function compareSessionsByActivity(
  left: SessionEntry,
  right: SessionEntry,
): number {
  const activityDelta =
    sessionActivityValue(right) - sessionActivityValue(left);
  if (activityDelta !== 0) return activityDelta;
  return right.path.localeCompare(left.path);
}

function sessionMatchesQuery(session: SessionEntry, query: string): boolean {
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

const workspaceGroups = computed<WorkspaceGroup[]>(() => {
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

  for (const session of props.sessions) {
    const id = getWorkspaceId(session);
    const existing = groups.get(id);
    const activity = sessionActivityValue(session);

    if (existing) {
      existing.sessions.push(session);
      existing.latestActivity = Math.max(existing.latestActivity, activity);
      continue;
    }

    groups.set(id, {
      id,
      name: getWorkspaceName(session),
      path: getWorkspacePath(session),
      sessions: [session],
      latestActivity: activity,
    });
  }

  return Array.from(groups.values())
    .map(group => {
      const sessions = [...group.sessions].sort(compareSessionsByActivity);
      const actualSessions = sessions.filter(
        session => !session.isWorkspacePlaceholder,
      );
      const query = workspaceQueries.value[group.id] ?? "";
      const remainingSessions = actualSessions.slice(RECENT_SESSION_LIMIT);
      const nextCursor = props.workspaceSessionCursors[group.path] ?? null;

      return {
        ...group,
        sessions,
        actualSessions,
        isExpanded: expandedWorkspaceIds.value.has(group.id),
        isActive: actualSessions.some(
          session => session.path === props.activeSessionPath,
        ),
        query,
        recentSessions: actualSessions.slice(0, RECENT_SESSION_LIMIT),
        remainingSessions,
        filteredRemainingSessions: remainingSessions.filter(session =>
          sessionMatchesQuery(session, query),
        ),
        nextCursor,
      };
    })
    .sort((left, right) => {
      const activityDelta = right.latestActivity - left.latestActivity;
      if (activityDelta !== 0) return activityDelta;
      return left.name.localeCompare(right.name);
    });
});

const activeOlderWorkspace = computed(
  () =>
    workspaceGroups.value.find(
      workspace => workspace.id === activeOlderWorkspaceId.value,
    ) ?? null,
);

const menuPanelStyle = computed(() => ({
  left: `${menu.value.x}px`,
  top: `${menu.value.y}px`,
}));

function expandWorkspace(workspaceId: string) {
  if (expandedWorkspaceIds.value.has(workspaceId)) return;
  expandedWorkspaceIds.value = new Set([
    ...expandedWorkspaceIds.value,
    workspaceId,
  ]);
}

function toggleWorkspace(workspaceId: string) {
  const next = new Set(expandedWorkspaceIds.value);
  if (next.has(workspaceId)) {
    next.delete(workspaceId);
  } else {
    next.add(workspaceId);
  }
  expandedWorkspaceIds.value = next;
}

function openOlderSessions(workspaceId: string) {
  workspaceQueries.value[workspaceId] ??= "";
  activeOlderWorkspaceId.value = workspaceId;
  const workspace = workspaceGroups.value.find(
    group => group.id === workspaceId,
  );
  if (workspace?.nextCursor && workspace.remainingSessions.length === 0) {
    emit("loadOlderSessions", {
      workspacePath: workspace.path,
      cursor: workspace.nextCursor,
    });
  }
}

function loadMoreOlderSessions(workspace: WorkspaceGroup) {
  if (!workspace.nextCursor) return;
  emit("loadOlderSessions", {
    workspacePath: workspace.path,
    cursor: workspace.nextCursor,
  });
}

function closeOlderSessions() {
  activeOlderWorkspaceId.value = null;
  closeMenu();
}

function isSessionRunning(sessionPath: string): boolean {
  return props.runningSessionPaths.includes(sessionPath);
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

  menu.value = {
    visible: true,
    sessionPath,
    x,
    y,
  };
}

function closeMenu() {
  menu.value.visible = false;
}

function startRename(sessionPath: string) {
  const session = props.sessions.find(s => s.path === sessionPath);
  if (!session) return;
  editingPath.value = sessionPath;
  editingName.value = session.name;
  closeMenu();
  nextTick(() => {
    editInputRef.value?.focus();
    editInputRef.value?.select();
  });
}

function confirmRename() {
  const name = editingName.value.trim();
  if (editingPath.value && name) {
    emit("rename", { sessionPath: editingPath.value, name });
  }
  editingPath.value = null;
  editingName.value = "";
}

function cancelRename() {
  editingPath.value = null;
  editingName.value = "";
}

function handleDelete(sessionPath: string) {
  closeMenu();
  if (!confirm("Delete this session? This cannot be undone.")) return;
  emit("delete", sessionPath);
}

function handleSessionSelect(sessionPath: string, closeModal = false) {
  if (editingPath.value === sessionPath) return;
  emit("select", sessionPath);
  if (closeModal) closeOlderSessions();
}

function handleWorkspaceNewSession(workspace: WorkspaceGroup) {
  if (workspace.path === "Unknown workspace") return;
  closeMenu();
  emit("newSession", workspace.path);
}

watch(
  () => props.sessions.map(session => session.path).join(","),
  () => {
    closeMenu();
  },
);

watch(
  () => [props.sessions, props.activeSessionPath] as const,
  ([sessions, activeSessionPath]) => {
    const activeSession = activeSessionPath
      ? sessions.find(session => session.path === activeSessionPath)
      : undefined;

    if (activeSession) {
      expandWorkspace(getWorkspaceId(activeSession));
      return;
    }

    if (sessions.length > 0 && expandedWorkspaceIds.value.size === 0) {
      expandWorkspace(getWorkspaceId(sessions[0]));
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="session-rail" @click="closeMenu">
    <div class="rail-header">
      <span class="rail-title">Workspaces</span>
      <div class="rail-actions">
        <slot name="header-actions"></slot>
      </div>
    </div>

    <div v-if="workspaceGroups.length > 0" class="rail-list">
      <section
        v-for="workspace in workspaceGroups"
        :key="workspace.id"
        class="workspace-group"
        :class="{
          expanded: workspace.isExpanded,
          active: workspace.isActive,
        }"
      >
        <div class="workspace-row" :title="workspace.path">
          <button
            class="workspace-toggle"
            type="button"
            :aria-expanded="workspace.isExpanded"
            @click="toggleWorkspace(workspace.id)"
          >
            <component
              :is="workspace.isExpanded ? FolderOpen : Folder"
              class="workspace-icon"
              aria-hidden="true"
            />
            <span class="workspace-copy">
              <span class="workspace-name">{{ workspace.name }}</span>
              <span class="workspace-path">{{ workspace.path }}</span>
            </span>
          </button>
          <button
            class="workspace-new-session"
            type="button"
            :aria-label="`New session in ${workspace.name}`"
            :title="`New session in ${workspace.path}`"
            @click.stop="handleWorkspaceNewSession(workspace)"
          >
            <Plus aria-hidden="true" />
          </button>
        </div>

        <div v-if="workspace.isExpanded" class="session-list">
          <p
            v-if="workspace.actualSessions.length === 0"
            class="workspace-empty"
          >
            No sessions yet
          </p>
          <div
            v-for="s in workspace.recentSessions"
            :key="s.path"
            class="rail-item"
            role="button"
            tabindex="0"
            :class="{
              active: s.path === activeSessionPath,
              running: isSessionRunning(s.path),
            }"
            @click="handleSessionSelect(s.path)"
            @keydown.enter.prevent="handleSessionSelect(s.path)"
            @contextmenu.prevent="openMenu($event, s.path)"
          >
            <span class="item-indicator"></span>
            <input
              v-if="editingPath === s.path"
              ref="editInputRef"
              v-model="editingName"
              class="item-input"
              type="text"
              @keydown.enter.prevent="confirmRename"
              @keydown.esc.prevent="cancelRename"
              @blur="confirmRename"
              @click.stop
            />
            <span v-else class="item-label">{{ s.name }}</span>
            <span
              v-if="isSessionRunning(s.path)"
              class="item-status"
              role="status"
              aria-label="Agent running"
              title="Agent running"
            >
              <span class="item-status-dot" aria-hidden="true"></span>
            </span>
          </div>

          <div
            v-if="
              workspace.remainingSessions.length > 0 || workspace.nextCursor
            "
            class="older-sessions"
          >
            <button
              class="older-toggle"
              type="button"
              aria-haspopup="dialog"
              @click="openOlderSessions(workspace.id)"
            >
              <span>Browse older sessions</span>
            </button>
          </div>
        </div>
      </section>
    </div>

    <p v-else class="rail-empty">No workspaces</p>
  </div>

  <div
    v-if="activeOlderWorkspace"
    class="older-modal-overlay"
    @click.self="closeOlderSessions"
  >
    <section
      class="older-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="`${activeOlderWorkspace.name} older sessions`"
      @keydown.escape="closeOlderSessions"
    >
      <label class="modal-session-search">
        <Search aria-hidden="true" />
        <input
          v-model="workspaceQueries[activeOlderWorkspace.id]"
          type="search"
          autocomplete="off"
          spellcheck="false"
          placeholder="Search older sessions"
          autofocus
        />
      </label>

      <div class="older-modal-list">
        <div
          v-for="s in activeOlderWorkspace.filteredRemainingSessions"
          :key="s.path"
          class="modal-session-item"
          role="button"
          tabindex="0"
          :class="{
            active: s.path === activeSessionPath,
            running: isSessionRunning(s.path),
          }"
          @click="handleSessionSelect(s.path, true)"
          @keydown.enter.prevent="handleSessionSelect(s.path, true)"
          @contextmenu.prevent="openMenu($event, s.path)"
        >
          <span class="item-indicator"></span>
          <span class="modal-session-copy">
            <input
              v-if="editingPath === s.path"
              ref="editInputRef"
              v-model="editingName"
              class="item-input modal-item-input"
              type="text"
              @keydown.enter.prevent="confirmRename"
              @keydown.esc.prevent="cancelRename"
              @blur="confirmRename"
              @click.stop
            />
            <span v-else class="modal-session-name">{{ s.name }}</span>
          </span>
          <span
            v-if="isSessionRunning(s.path)"
            class="item-status"
            role="status"
            aria-label="Agent running"
            title="Agent running"
          >
            <span class="item-status-dot" aria-hidden="true"></span>
          </span>
        </div>

        <button
          v-if="activeOlderWorkspace.nextCursor"
          class="modal-load-more"
          type="button"
          @click="loadMoreOlderSessions(activeOlderWorkspace)"
        >
          Load more
        </button>

        <p
          v-if="activeOlderWorkspace.filteredRemainingSessions.length === 0"
          class="modal-empty"
        >
          No matching sessions
        </p>
      </div>
    </section>
  </div>

  <div
    v-if="menu.visible"
    class="menu-overlay"
    @click.stop="closeMenu"
    @contextmenu.prevent.stop="closeMenu"
  >
    <div class="menu-panel show" :style="menuPanelStyle" @click.stop>
      <button
        class="menu-item"
        type="button"
        @click="startRename(menu.sessionPath!)"
      >
        <Pencil class="menu-icon" aria-hidden="true" />
        <span>Rename</span>
      </button>
      <div class="menu-divider"></div>
      <button
        class="menu-item danger"
        type="button"
        @click="handleDelete(menu.sessionPath!)"
      >
        <Trash2 class="menu-icon" aria-hidden="true" />
        <span>Delete</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.session-rail {
  display: flex;
  flex-direction: column;
  padding: 0px 10px 0;
  overflow: hidden;
  position: relative;
}

.rail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  color: var(--text-subtle);
  flex-shrink: 0;
}

.rail-title {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.rail-actions {
  display: flex;
  align-items: center;
  gap: 4px;
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

.workspace-group.active {
  background: transparent;
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

.workspace-toggle:focus-visible,
.workspace-new-session:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.workspace-group.active > .workspace-row {
  color: inherit;
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
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 72%, transparent);
  color: var(--text-subtle);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transform: translateX(2px) scale(0.96);
  transition:
    background 0.14s ease,
    border-color 0.14s ease,
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
  border-color: color-mix(in srgb, var(--border-strong) 70%, transparent);
  background: var(--surface-hover);
  color: var(--text-muted);
}

.workspace-new-session svg {
  width: 14px;
  height: 14px;
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
  background: var(--diff-added-accent);
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
  background: var(--diff-added-accent);
  box-shadow: 0 0 0 0
    color-mix(in srgb, var(--diff-added-accent) 34%, transparent);
  animation:
    session-running-blink 1.1s ease-in-out infinite,
    session-running-ping 1.8s ease-out infinite;
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

.older-toggle:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--focus-ring);
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

.modal-session-search svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
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

.modal-session-item.active .item-indicator {
  background: var(--text);
}

.modal-session-item.running .item-indicator {
  background: var(--diff-added-accent);
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

.modal-load-more:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring);
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

.menu-item:focus-visible {
  outline: none;
  background: var(--surface-active);
  color: var(--text);
}

.menu-item.danger {
  color: var(--text-muted);
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

  .modal-session-search svg {
    width: 16px;
    height: 16px;
  }

  .modal-session-search input {
    height: 36px;
    font-size: 0.95rem;
  }

  .older-modal-list {
    padding: 0 8px 10px;
  }

  .modal-session-item {
    align-items: flex-start;
    gap: 8px;
    min-height: 0;
    padding: 8px 10px;
  }

  .modal-session-copy {
    align-items: flex-start;
    padding-top: 1px;
  }

  .modal-session-name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .item-status {
    width: 16px;
    height: 16px;
    margin-top: 2px;
  }

  .modal-load-more {
    margin: 8px 8px 2px;
  }

  .modal-empty {
    padding: 16px 10px;
  }
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

@keyframes session-running-ping {
  0% {
    box-shadow: 0 0 0 0
      color-mix(in srgb, var(--diff-added-accent) 34%, transparent);
  }

  75% {
    box-shadow: 0 0 0 6px
      color-mix(in srgb, var(--diff-added-accent) 0%, transparent);
  }

  100% {
    box-shadow: 0 0 0 0
      color-mix(in srgb, var(--diff-added-accent) 0%, transparent);
  }
}
</style>
