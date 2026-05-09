<script lang="ts">
  import type { RpcImageContent, RpcThinkingLevel } from "@pi-web/bridge/types";
  import { onMount } from "svelte";
  import ExtensionDialog from "./components/ExtensionDialog.svelte";
  import ReconnectBanner from "./components/ReconnectBanner.svelte";
  import ThemeSettingsDialog from "./components/ThemeSettingsDialog.svelte";
  import { initBridge } from "./composables/bridgeStore.svelte";
  import AppHeader from "./layout/AppHeader.svelte";
  import AppMainContent from "./layout/AppMainContent.svelte";
  import AppNotifications from "./layout/AppNotifications.svelte";
  import AppRightSidebar from "./layout/AppRightSidebar.svelte";
  import AppSidebar from "./layout/AppSidebar.svelte";
  import {
    listThemes,
    readStoredThemePreference,
    resolveActiveTheme,
    resolveAppThemeVars,
    serializeThemePreference,
    setThemePreferenceTheme,
    toggleThemePreferenceMode,
    type ThemeMode,
    type ThemePreference,
  } from "./themes";
  import { readInitialDebugMode } from "./utils/debugMode";
  import type { RpcModelInfo } from "./utils/models";
  import { parseCompactSlashCommand } from "./utils/slashCommands";

  type RightSidebarTabId = string;

  type FileViewerTab = {
    id: string;
    path: string;
    lineNumber: number;
  };

  const bridge = initBridge();

  const TREE_TAB_ID = "tree";

  let sidebarOpen = $state(false);
  let leftSidebarCollapsed = $state(false);
  let outlineSidebarOpen = $state(false);
  let themeSettingsOpen = $state(false);
  let activeRightSidebarTabId = $state<RightSidebarTabId>(TREE_TAB_ID);
  let fileViewerTabs = $state<FileViewerTab[]>([]);
  let mainContentRef: AppMainContent | null = $state(null);
  let pendingRevision = $state<{
    entryId: string;
    text: string;
    preview: string;
    hasImages: boolean;
    images: RpcImageContent[];
  } | null>(null);
  let editQueuedPayload = $state<{
    text: string;
    images: RpcImageContent[];
  } | null>(null);

  const THEME_CACHE_KEY = "pi-web-theme";
  const DEBUG_MODE_CACHE_KEY = "pi-web-debug-mode";
  const LEFT_RAIL_WIDTH_CACHE_KEY = "pi-web-left-rail-width";
  const RIGHT_RAIL_WIDTH_CACHE_KEY = "pi-web-right-rail-width";
  const LEFT_RAIL_MIN_WIDTH = 260;
  const LEFT_RAIL_MAX_WIDTH = 520;
  const LEFT_RAIL_DEFAULT_WIDTH = 320;
  const RIGHT_RAIL_MIN_WIDTH = 240;
  const RIGHT_RAIL_MAX_WIDTH = 760;
  const RIGHT_RAIL_DEFAULT_WIDTH = 420;
  const MIN_CENTER_COLUMN_WIDTH = 360;

  type RailSide = "left" | "right";

  function readCachedThemePreference(): ThemePreference {
    if (typeof window === "undefined") return readStoredThemePreference(null, false);
    return readStoredThemePreference(
      window.localStorage.getItem(THEME_CACHE_KEY),
      window.matchMedia("(prefers-color-scheme: light)").matches,
    );
  }

  const debugModeAvailable =
    typeof window !== "undefined" &&
    window.__PI_WEB_CONFIG__?.debugModeAvailable === true;

  function readCachedDebugMode(): boolean {
    if (typeof window === "undefined") return false;
    return readInitialDebugMode(
      debugModeAvailable,
      window.localStorage.getItem(DEBUG_MODE_CACHE_KEY),
      window.location.search,
    );
  }

  function readCachedRailWidth(
    cacheKey: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    if (typeof window === "undefined") return fallback;
    const cached = Number.parseInt(
      window.localStorage.getItem(cacheKey) ?? "",
      10,
    );
    return Number.isFinite(cached)
      ? Math.min(max, Math.max(min, cached))
      : fallback;
  }

  let themePreference = $state<ThemePreference>(readCachedThemePreference());
  let debugMode = $state(readCachedDebugMode());
  let compactLayout = $state(isCompactLayout());
  let leftRailWidth = $state(
    readCachedRailWidth(LEFT_RAIL_WIDTH_CACHE_KEY, LEFT_RAIL_DEFAULT_WIDTH, LEFT_RAIL_MIN_WIDTH, LEFT_RAIL_MAX_WIDTH),
  );
  let rightRailWidth = $state(
    readCachedRailWidth(RIGHT_RAIL_WIDTH_CACHE_KEY, RIGHT_RAIL_DEFAULT_WIDTH, RIGHT_RAIL_MIN_WIDTH, RIGHT_RAIL_MAX_WIDTH),
  );
  let activeRailResize = $state<{
    side: RailSide;
    startX: number;
    startWidth: number;
  } | null>(null);

  const darkThemes = listThemes("dark");
  const lightThemes = listThemes("light");

  let activeTheme = $derived(resolveActiveTheme(themePreference));
  function styleString(styles: Record<string, string>): string {
    return Object.entries(styles)
      .map(([key, value]) => `${key}: ${value}`)
      .join("; ");
  }

  let allStyle = $derived.by(() => {
    const s: Record<string, string> = {
      ...resolveAppThemeVars(activeTheme),
      "color-scheme": String(activeTheme.mode),
    };
    if (!compactLayout) {
      s["grid-template-columns"] = leftSidebarCollapsed
        ? "minmax(0, 1fr)"
        : `${leftRailWidth}px minmax(0, 1fr)`;
    }
    return styleString(s);
  });
  let nextThemeLabel = $derived<ThemeMode>(
    activeTheme.mode === "dark" ? "light" : "dark",
  );
  let debugModeLabel = $derived(
    debugMode ? "Disable debug mode" : "Enable debug mode",
  );
  let hasRightSidebarContent = $derived(
    bridge.hasSessionOutline || fileViewerTabs.length > 0,
  );

  function getWorkspaceDisplayName(workspacePath?: string | null): string | null {
    const np = workspacePath?.trim();
    if (!np) return null;
    const parts = np.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) ?? np;
  }

  let activeSessionEntry = $derived(
    bridge.sessions.find(
      s => s.path === bridge.activeSessionPath || s.id === bridge.sessionState?.sessionId,
    ) ?? null,
  );
  let activeSessionLabel = $derived.by(() => {
    if (!bridge.hasSessionOutline) return "No active session";
    return (
      bridge.sessionState?.sessionName ??
      activeSessionEntry?.name ??
      bridge.sessionState?.sessionId ??
      "Untitled session"
    );
  });
  let activeWorkspaceLabel = $derived.by(() => {
    const wn = activeSessionEntry?.workspaceName?.trim();
    return (
      wn ||
      getWorkspaceDisplayName(activeSessionEntry?.workspacePath) ||
      getWorkspaceDisplayName(bridge.sessionState?.workspacePath)
    );
  });

  let activeFileViewerTab = $derived(
    fileViewerTabs.find(t => t.id === activeRightSidebarTabId) ?? null,
  );

  let showLeftRailResizer = $derived(
    !compactLayout && !leftSidebarCollapsed,
  );
  let showRightRailResizer = $derived(
    !compactLayout && hasRightSidebarContent && outlineSidebarOpen,
  );

  let appBodyStyle = $derived(
    !compactLayout && hasRightSidebarContent && outlineSidebarOpen
      ? `grid-template-columns: minmax(0, 1fr) ${rightRailWidth}px`
      : undefined,
  );
  let leftRailResizerStyle = $derived(`left: ${leftRailWidth - 5}px`);
  let rightRailResizerStyle = $derived(`right: ${rightRailWidth - 5}px`);

  function fileViewerTabId(path: string): string {
    return `file:${path.replace(/\\/g, "/")}`;
  }

  function defaultRightSidebarTabId(): RightSidebarTabId | null {
    if (bridge.hasSessionOutline) return TREE_TAB_ID;
    return fileViewerTabs[0]?.id ?? null;
  }

  function ensureActiveRightSidebarTab() {
    if (activeRightSidebarTabId === TREE_TAB_ID && bridge.hasSessionOutline) return;

    const activeFileTab = fileViewerTabs.find(
      t => t.id === activeRightSidebarTabId,
    );
    if (activeFileTab) return;

    activeRightSidebarTabId = defaultRightSidebarTabId() ?? TREE_TAB_ID;
  }

  function openFileViewer(path: string, lineNumber: number) {
    const tp = path.trim();
    if (!tp) return;

    const nl = Number.isInteger(lineNumber) && lineNumber > 0 ? lineNumber : 1;
    const id = fileViewerTabId(tp);
    const ei = fileViewerTabs.findIndex(t => t.id === id);
    if (ei >= 0) {
      const nt = [...fileViewerTabs];
      nt[ei] = { ...nt[ei], lineNumber: nl };
      fileViewerTabs = nt;
    } else {
      fileViewerTabs = [...fileViewerTabs, { id, path: tp, lineNumber: nl }];
    }

    activeRightSidebarTabId = id;
    outlineSidebarOpen = true;
    if (compactLayout) {
      sidebarOpen = false;
    } else {
      rightRailWidth = clampRailWidth("right", rightRailWidth);
    }
  }

  function closeFileViewerTab(tabId: string) {
    const ci = fileViewerTabs.findIndex(t => t.id === tabId);
    if (ci === -1) return;

    const nt = fileViewerTabs.filter(t => t.id !== tabId);
    fileViewerTabs = nt;

    if (activeRightSidebarTabId !== tabId) return;

    const fb = nt[ci] ?? nt[ci - 1];
    if (fb) {
      activeRightSidebarTabId = fb.id;
      return;
    }

    if (bridge.hasSessionOutline) {
      activeRightSidebarTabId = TREE_TAB_ID;
      return;
    }

    outlineSidebarOpen = false;
  }

  function isCompactLayout(): boolean {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function maxRailWidth(side: RailSide): number {
    if (typeof window === "undefined")
      return side === "left" ? LEFT_RAIL_MAX_WIDTH : RIGHT_RAIL_MAX_WIDTH;

    const vw = window.innerWidth;
    if (side === "left") {
      const rrw = !compactLayout && hasRightSidebarContent && outlineSidebarOpen
        ? rightRailWidth
        : 0;
      return Math.max(
        LEFT_RAIL_MIN_WIDTH,
        Math.min(LEFT_RAIL_MAX_WIDTH, vw - rrw - MIN_CENTER_COLUMN_WIDTH),
      );
    }

    const rlw = !compactLayout && !leftSidebarCollapsed ? leftRailWidth : 0;
    return Math.max(
      RIGHT_RAIL_MIN_WIDTH,
      Math.min(RIGHT_RAIL_MAX_WIDTH, vw - rlw - MIN_CENTER_COLUMN_WIDTH),
    );
  }

  function clampRailWidth(side: RailSide, width: number): number {
    const minWidth =
      side === "left" ? LEFT_RAIL_MIN_WIDTH : RIGHT_RAIL_MIN_WIDTH;
    const maxWidth = maxRailWidth(side);
    return Math.round(Math.min(maxWidth, Math.max(minWidth, width)));
  }

  function normalizeRailWidths() {
    leftRailWidth = clampRailWidth("left", leftRailWidth);
    rightRailWidth = clampRailWidth("right", rightRailWidth);
  }

  function syncCompactLayout() {
    compactLayout = isCompactLayout();
    if (compactLayout) {
      stopRailResize();
      return;
    }
    normalizeRailWidths();
  }

  function startRailResize(side: RailSide, event: PointerEvent) {
    if (compactLayout) return;
    if (side === "left" && leftSidebarCollapsed) return;
    if (side === "right" && (!hasRightSidebarContent || !outlineSidebarOpen))
      return;

    event.preventDefault();
    activeRailResize = {
      side,
      startX: event.clientX,
      startWidth: side === "left" ? leftRailWidth : rightRailWidth,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handleRailResize);
    window.addEventListener("pointerup", stopRailResize);
    window.addEventListener("pointercancel", stopRailResize);
  }

  function handleRailResize(event: PointerEvent) {
    if (!activeRailResize) return;

    const delta = event.clientX - activeRailResize.startX;
    if (activeRailResize.side === "left") {
      leftRailWidth = clampRailWidth(
        "left",
        activeRailResize.startWidth + delta,
      );
      return;
    }

    rightRailWidth = clampRailWidth(
      "right",
      activeRailResize.startWidth - delta,
    );
  }

  function stopRailResize() {
    if (!activeRailResize && typeof window === "undefined") return;
    activeRailResize = null;
    if (typeof document !== "undefined") {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pointermove", handleRailResize);
      window.removeEventListener("pointerup", stopRailResize);
      window.removeEventListener("pointercancel", stopRailResize);
    }
  }

  function resetRailWidth(side: RailSide) {
    if (side === "left") {
      leftRailWidth = clampRailWidth("left", LEFT_RAIL_DEFAULT_WIDTH);
      return;
    }

    rightRailWidth = clampRailWidth("right", RIGHT_RAIL_DEFAULT_WIDTH);
  }

  function toggleTheme() {
    themePreference = toggleThemePreferenceMode(themePreference);
  }

  function openThemeSettings() {
    themeSettingsOpen = true;
  }

  function closeThemeSettings() {
    themeSettingsOpen = false;
  }

  function handleThemePresetSelect(themeId: string) {
    themePreference = setThemePreferenceTheme(
      themePreference,
      themePreference.mode,
      themeId,
    );
  }

  function toggleSessionSidebar() {
    const nextOpen = !sidebarOpen;
    sidebarOpen = nextOpen;
    if (nextOpen && compactLayout) {
      outlineSidebarOpen = false;
    }
  }

  function toggleLeftSidebarCollapse() {
    leftSidebarCollapsed = !leftSidebarCollapsed;
  }

  function toggleDebugMode() {
    if (!debugModeAvailable) return;
    debugMode = !debugMode;
  }

  async function handleSessionSelect(sessionPath: string) {
    pendingRevision = null;
    mainContentRef?.rememberTranscriptScroll();
    try {
      const response = await bridge.switchSession(sessionPath);
      if (response.success) {
        sidebarOpen = false;
      }
    } catch {
      // Keep current sidebar state
    }
  }

  function handleRefreshWorkspaces() {
    bridge.refreshWorkspaces().then(() => {
      for (const workspacePath of Object.keys(bridge.workspaceSessionLoaded)) {
        if (bridge.workspaceSessionLoaded[workspacePath]) {
          bridge.loadWorkspaceSessions({
            workspacePath,
            limit: 5,
            merge: "replace",
          }).catch(() => {});
        }
      }
    }).catch(() => {});
  }

  function handleExpandWorkspace(workspacePath: string) {
    if (bridge.workspaceSessionLoaded[workspacePath] || bridge.workspaceSessionLoading[workspacePath]) {
      return;
    }
    bridge.loadWorkspaceSessions({
      workspacePath,
      limit: 5,
      merge: "replace",
    }).catch(() => {});
  }

  function handleLoadOlderSessions(payload: {
    workspacePath: string;
    cursor?: string | null;
  }) {
    bridge.loadWorkspaceSessions({
      workspacePath: payload.workspacePath,
      cursor: payload.cursor,
      limit: 50,
      merge: "append",
    }).catch(() => {});
  }

  async function handleNewSession(workspacePath: string) {
    pendingRevision = null;
    mainContentRef?.rememberTranscriptScroll();
    try {
      const response = await bridge.newSession(workspacePath);
      if (response.success) {
        sidebarOpen = false;
      }
    } catch {
      // Keep current sidebar state
    }
  }

  async function handleRegisterWorkspace() {
    try {
      const response = await bridge.registerWorkspace();
      if (response.success) {
        const data = response.data as
          | { cancelled?: boolean; workspacePath?: string }
          | undefined;
        if (data?.cancelled) return;
        handleRefreshWorkspaces();
      }
    } catch {
      // Ignore
    }
  }

  async function handleDeleteSession(sessionPath: string) {
    try {
      const response = await bridge.deleteSession(sessionPath);
      if (response.success) handleRefreshWorkspaces();
    } catch {
      // Ignore
    }
  }

  function toggleOutlineSidebar() {
    const nextOpen = !outlineSidebarOpen;
    outlineSidebarOpen = nextOpen;
    if (!nextOpen) return;

    ensureActiveRightSidebarTab();
    if (compactLayout) {
      sidebarOpen = false;
    } else {
      rightRailWidth = clampRailWidth("right", rightRailWidth);
    }

    if (activeRightSidebarTabId === TREE_TAB_ID) {
      handleRefreshTree();
    }
  }

  function handleRightSidebarTabSelect(tabId: string) {
    activeRightSidebarTabId = tabId;
    if (tabId === TREE_TAB_ID) handleRefreshTree();
  }

  function handleOpenFileReference(payload: {
    path: string;
    lineNumber: number;
  }) {
    openFileViewer(payload.path, payload.lineNumber);
  }

  function handleRefreshTree() {
    if (!bridge.hasSessionOutline) return;

    const sp = bridge.activeSessionPath ?? undefined;
    bridge.sendCommand({ type: "list_tree_entries", sessionPath: sp }).catch(() => {});
  }

  async function revealTreeEntryInTranscript(entryId: string): Promise<boolean> {
    if (mainContentRef?.scrollToTranscriptEntry(entryId)) return true;

    try {
      await bridge.sendCommand({
        type: "get_messages",
        direction: "latest",
        limit: 40,
      });
      await tick();
      if (mainContentRef?.scrollToTranscriptEntry(entryId)) return true;
    } catch {
      // Keep current bridge.transcript
    }

    const MAX_HISTORY_PAGES = 50;
    for (let page = 0; page < MAX_HISTORY_PAGES && bridge.transcriptHasOlder; page++) {
      await bridge.loadOlderTranscriptPage();
      await tick();
      if (mainContentRef?.scrollToTranscriptEntry(entryId)) return true;
    }

    return false;
  }

  async function handleTreeEntrySelect(entryId: string) {
    pendingRevision = null;

    const entry = bridge.treeEntries.find(c => c.id === entryId);
    if (entry?.isOnActivePath) {
      const revealed = await revealTreeEntryInTranscript(entryId);
      if (revealed) {
        if (compactLayout) outlineSidebarOpen = false;
        return;
      }
    }

    try {
      const response = await bridge.sendCommand({
        type: "select_tree_entry",
        entryId,
      });
      if (response.success) {
        await tick();
        mainContentRef?.scrollToTranscriptEntry(entryId);
        if (compactLayout) outlineSidebarOpen = false;
      }
    } catch {
      // Keep state
    }
  }

  async function handlePrompt(payload: {
    message: string;
    images: RpcImageContent[];
    revisionEntryId?: string;
    steer?: boolean;
  }) {
    const compactCommand = parseCompactSlashCommand(payload.message);
    if (compactCommand) {
      pendingRevision = null;
      bridge.compactSession(compactCommand.customInstructions).catch(() => {});
      return;
    }

    if (payload.revisionEntryId) {
      try {
        const response = await bridge.sendCommand({
          type: "navigate_tree",
          entryId: payload.revisionEntryId,
        });
        if (!response.success) return;
        const result = response.data as { cancelled?: boolean } | undefined;
        if (result?.cancelled) return;
      } catch {
        return;
      }
    }

    pendingRevision = null;
    bridge.sendPrompt(
      payload.message,
      payload.images,
      payload.steer ? "steer" : "followUp",
    );
  }

  function handleReviseMessage(payload: {
    entryId: string;
    text: string;
    preview: string;
    hasImages: boolean;
    images: RpcImageContent[];
  }) {
    pendingRevision = payload;
  }

  function handleCancelRevision() {
    pendingRevision = null;
  }

  async function handleCancelQueued(index: number) {
    await bridge.cancelQueuedMessage(index);
  }

  async function handleEditQueued(index: number) {
    const item = await bridge.editQueuedMessage(index);
    if (!item) return;
    editQueuedPayload = item;
  }

  function handleAbort() {
    bridge.abortGeneration().catch(() => {});
  }

  function handleModelSelect(model: RpcModelInfo) {
    if (
      bridge.currentModel &&
      bridge.currentModel.provider === model.provider &&
      bridge.currentModel.id === model.id
    )
      return;

    bridge.sendCommand({
      type: "set_model",
      provider: model.provider,
      modelId: model.id,
    }).catch(() => {});
  }

  function handleThinkingLevelSelect(level: RpcThinkingLevel) {
    if (bridge.currentThinkingLevel === level) return;
    bridge.setThinkingLevel(level).catch(() => {});
  }

  function handleAutoCompactionToggle(enabled: boolean) {
    if (bridge.sessionState?.autoCompactionEnabled === enabled) return;
    bridge.setAutoCompactionEnabled(enabled).catch(() => {});
  }

  function handleUIRespond(payload: Parameters<typeof bridge.respondToUIRequest>[0]) {
    bridge.respondToUIRequest(payload);
  }

  function handleDismissNotification(id: string) {
    bridge.dismissNotification(id);
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    if (event.key !== "Escape") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!bridge.isStreaming) return;
    event.preventDefault();
    handleAbort();
  }

  // Effects
  $effect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_CACHE_KEY, serializeThemePreference(themePreference));
    }
  });

  $effect(() => {
    if (!debugModeAvailable) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DEBUG_MODE_CACHE_KEY, String(debugMode));
    }
  });

  $effect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LEFT_RAIL_WIDTH_CACHE_KEY, String(leftRailWidth));
    }
  });

  $effect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RIGHT_RAIL_WIDTH_CACHE_KEY, String(rightRailWidth));
    }
  });

  $effect(() => {
    if (bridge.connectionStatus === "disconnected") {
      mainContentRef?.preserveTranscriptScroll();
      pendingRevision = null;
      outlineSidebarOpen = false;
    }
  });

  $effect(() => {
    if (bridge.sessionState?.sessionFile) {
      // Trigger side-effect: reset pending revision on session switch
      pendingRevision = null;
    }
  });

  $effect(() => {
    if (!bridge.hasSessionOutline && activeRightSidebarTabId === TREE_TAB_ID) {
      const fb = fileViewerTabs[0];
      if (fb) {
        activeRightSidebarTabId = fb.id;
        return;
      }
    }

    if (!bridge.hasSessionOutline && fileViewerTabs.length === 0) {
      outlineSidebarOpen = false;
      return;
    }

    ensureActiveRightSidebarTab();
  });

  $effect(() => {
    if (fileViewerTabs.length === 0 && !bridge.hasSessionOutline) {
      outlineSidebarOpen = false;
    }
    ensureActiveRightSidebarTab();
  });

  $effect(() => {
    // Normalize rail widths when layout changes
    if (compactLayout) {
      if (activeRailResize) stopRailResize();
      return;
    }

    if (activeRailResize?.side === "left" && leftSidebarCollapsed) {
      stopRailResize();
      return;
    }

    if (
      activeRailResize?.side === "right" &&
      (!hasRightSidebarContent || !outlineSidebarOpen)
    ) {
      stopRailResize();
      return;
    }

    normalizeRailWidths();
  });

  // Auto-dismiss bridge.notifications after 5 seconds
  let notificationTimerIds = new Set<string>();

  $effect(() => {
    for (const n of bridge.notifications) {
      if (notificationTimerIds.has(n.id)) continue;
      notificationTimerIds.add(n.id);
      setTimeout(() => bridge.dismissNotification(n.id), 5000);
    }
  });

  function tick(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  const compatWarningVisible = $state(false);

  onMount(() => {
    syncCompactLayout();

    return () => {
      stopRailResize();
    };
  });
</script>

<svelte:window onresize={syncCompactLayout} onkeydown={handleGlobalKeydown} />

<div
  class="app-shell"
  class:left-rail-collapsed={leftSidebarCollapsed}
  data-theme={activeTheme.id}
  data-theme-mode={activeTheme.mode}
  data-dark-theme={themePreference.darkThemeId}
  data-light-theme={themePreference.lightThemeId}
  style={allStyle}
>
  <AppSidebar
    workspaces={bridge.workspaces}
    workspaceSessions={bridge.workspaceSessions}
    activeSessionPath={bridge.activeSessionPath}
    activeWorkspacePath={bridge.sessionState?.workspacePath ?? activeSessionEntry?.workspacePath ?? null}
    runningSessionPaths={bridge.runningSessionPaths}
    workspaceSessionLoaded={bridge.workspaceSessionLoaded}
    workspaceSessionLoading={bridge.workspaceSessionLoading}
    workspaceSessionCursors={bridge.workspaceSessionCursors}
    {sidebarOpen}
    collapsed={leftSidebarCollapsed}
    onRegisterWorkspace={handleRegisterWorkspace}
    onCloseSidebar={() => (sidebarOpen = false)}
    onSelectSession={handleSessionSelect}
    onRefreshWorkspaces={handleRefreshWorkspaces}
    onExpandWorkspace={handleExpandWorkspace}
    onLoadOlderSessions={handleLoadOlderSessions}
    onNewSession={handleNewSession}
    onDeleteSession={handleDeleteSession}
  />

  {#if showLeftRailResizer}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="rail-resizer left"
      class:active={activeRailResize?.side === "left"}
      style={leftRailResizerStyle}
      role="separator"
      aria-label="Resize left sidebar. Double-click to reset."
      tabindex="0"
      title="Drag to resize bridge.sessions sidebar. Double-click to reset."
      onpointerdown={(e) => startRailResize("left", e)}
      ondblclick={() => resetRailWidth("left")}
    ></div>
  {/if}

  <div class="app-main-column">
    <AppHeader
      theme={activeTheme.mode}
      {nextThemeLabel}
      sessionTitle={activeSessionLabel}
      workspaceName={activeWorkspaceLabel}
      showDebugToggle={debugModeAvailable}
      {debugMode}
      {debugModeLabel}
      sidebarCollapsed={leftSidebarCollapsed}
      showOutlineToggle={hasRightSidebarContent}
      outlineSidebarOpen={outlineSidebarOpen}
      onToggleSidebar={toggleSessionSidebar}
      onToggleSidebarCollapse={toggleLeftSidebarCollapse}
      onToggleOutlineSidebar={toggleOutlineSidebar}
      onToggleTheme={toggleTheme}
      onOpenThemeSettings={openThemeSettings}
      onToggleDebugMode={toggleDebugMode}
    />

    <ReconnectBanner
      visible={bridge.isReconnecting}
      reason={bridge.lastDisconnectReason}
      reconnectCount={bridge.reconnectCount}
    />

    <div
      class="app-body"
      class:has-right-rail={hasRightSidebarContent}
      class:right-rail-open={hasRightSidebarContent && outlineSidebarOpen}
      style={appBodyStyle ? appBodyStyle : undefined}
    >
      <AppMainContent
        bind:this={mainContentRef}
        {compatWarningVisible}
        statusEntries={bridge.statusEntries}
        activeSessionPath={bridge.activeSessionPath}
        transcript={bridge.transcript}
        transcriptHasOlder={bridge.transcriptHasOlder}
        transcriptInitialLoading={bridge.transcriptInitialLoading}
        transcriptPageLoading={bridge.transcriptPageLoading}
        pendingTranscriptConfigEvent={bridge.pendingTranscriptConfigEvent}
        isStreaming={bridge.isStreaming}
        isCompacting={bridge.isCompacting}
        isDebugMode={debugModeAvailable && debugMode}
        connectionStatus={bridge.connectionStatus}
        commands={bridge.commands}
        workspaceEntries={bridge.workspaceEntries}
        workspaceEntriesLoading={bridge.workspaceEntriesLoading}
        workspaceContextKey={bridge.sessionState?.workspacePath ?? bridge.activeSessionPath}
        ensureWorkspaceEntries={bridge.fetchWorkspaceEntries}
        availableModels={bridge.availableModels}
        currentModel={bridge.currentModel}
        currentThinkingLevel={bridge.currentThinkingLevel}
        autoCompactionEnabled={bridge.sessionState?.autoCompactionEnabled ?? false}
        sessionStats={bridge.sessionStats}
        sessionState={bridge.sessionState}
        gitRepoState={bridge.gitRepoState}
        gitRepoLoading={bridge.gitRepoLoading}
        gitBranchSwitching={bridge.gitBranchSwitching}
        refreshGitRepoState={bridge.loadGitRepoState}
        switchGitBranch={bridge.switchGitBranch}
        createGitBranch={bridge.createGitBranch}
        prefillText={bridge.prefillText}
        {pendingRevision}
        allowRevision={bridge.connectionStatus === "connected"}
        pendingMessageCount={bridge.pendingMessageCount}
        queuedUserMessages={bridge.queuedUserMessages}
        {editQueuedPayload}
        onSubmit={handlePrompt}
        onLoadOlderTranscript={bridge.loadOlderTranscriptPage}
        onAbort={handleAbort}
        onReviseMessage={handleReviseMessage}
        onCancelRevision={handleCancelRevision}
        onCancelQueued={handleCancelQueued}
        onEditQueued={handleEditQueued}
        onSelectModel={handleModelSelect}
        onSelectThinkingLevel={handleThinkingLevelSelect}
        onToggleAutoCompaction={handleAutoCompactionToggle}
        onOpenFileReference={handleOpenFileReference}
      />

      {#if showRightRailResizer}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          class="rail-resizer right"
          class:active={activeRailResize?.side === "right"}
          style={rightRailResizerStyle}
          role="separator"
          aria-label="Resize right sidebar. Double-click to reset."
          tabindex="0"
          title="Drag to resize the right sidebar. Double-click to reset."
          onpointerdown={(e) => startRailResize("right", e)}
          ondblclick={() => resetRailWidth("right")}
        ></div>
      {/if}

      {#if hasRightSidebarContent && outlineSidebarOpen}
        <AppRightSidebar
          treeEntries={bridge.treeEntries}
          sidebarOpen={outlineSidebarOpen}
          sessionPath={bridge.activeSessionPath}
          hasTreeTab={bridge.hasSessionOutline}
          activeTabId={activeRightSidebarTabId}
          activeFileTab={activeFileViewerTab}
          {fileViewerTabs}
          readWorkspaceFile={bridge.readWorkspaceFile}
          onCloseSidebar={() => (outlineSidebarOpen = false)}
          onSelectTab={handleRightSidebarTabSelect}
          onCloseFileTab={closeFileViewerTab}
          onSelectTreeEntry={handleTreeEntrySelect}
        />
      {/if}
    </div>
  </div>

  <AppNotifications
    connectionError={bridge.connectionError}
    notifications={bridge.notifications}
    onDismiss={handleDismissNotification}
  />

  <ThemeSettingsDialog
    open={themeSettingsOpen}
    mode={themePreference.mode}
    darkThemeId={themePreference.darkThemeId}
    lightThemeId={themePreference.lightThemeId}
    {darkThemes}
    {lightThemes}
    themeStyle={allStyle}
    onClose={closeThemeSettings}
    onSetTheme={handleThemePresetSelect}
  />

  <ExtensionDialog
    request={bridge.pendingExtensionRequest}
    onRespond={handleUIRespond}
  />
</div>

<style>
  .app-shell {
    --pi-font-sans:
      -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --pi-font-mono:
      ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono",
      monospace;
    display: grid;
    grid-template-columns: clamp(280px, 24vw, 360px) minmax(0, 1fr);
    height: 100vh;
    height: 100dvh;
    width: 100vw;
    overflow: hidden;
    background: var(--bg, #0d1117);
    color: var(--text, #e6edf3);
    font-family: var(--pi-font-sans);
    position: relative;
  }

  .rail-resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 10px;
    cursor: col-resize;
    z-index: 25;
    touch-action: none;
  }


  .app-shell ::selection {
    background: var(--selection-bg);
  }

  .app-shell[data-theme-mode="dark"] :global(pre.shiki) {
    background-color: var(--shiki-dark-bg) !important;
  }

  .app-shell[data-theme-mode="dark"] :global(pre.shiki),
  .app-shell[data-theme-mode="dark"] :global(pre.shiki span) {
    color: var(--shiki-dark) !important;
  }

  .app-shell.left-rail-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }

  .app-shell.left-rail-collapsed .app-main-column {
    background: var(--bg);
  }

  .app-main-column {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--rail-bg);
  }

  .app-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .app-body.has-right-rail {
    position: relative;
  }

  .app-body.has-right-rail.right-rail-open {
    grid-template-columns: minmax(0, 1fr) clamp(280px, 22vw, 340px);
  }

  @media (max-width: 900px) {
    .app-shell {
      --mobile-header-offset: calc(env(safe-area-inset-top) + 50px);
      display: flex;
      flex-direction: column;
    }

    .rail-resizer {
      display: none;
    }

    .app-body,
    .app-body.has-right-rail,
    .app-body.has-right-rail.right-rail-open {
      grid-template-columns: 1fr;
      position: relative;
    }
  }
</style>
