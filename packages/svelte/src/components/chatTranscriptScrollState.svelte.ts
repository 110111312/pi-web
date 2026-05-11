// ---------------------------------------------------------------------------
// Chat transcript scroll management
//
// All DOM-dependent functions accept a container parameter so the
// consuming component can supply it from its bind:this ref.
// ---------------------------------------------------------------------------

const TREE_ENTRY_SELECTOR = "[data-tree-entry-id], [data-tree-entry-ids]";
const TOP_LOAD_THRESHOLD = 120;
const AUTO_SCROLL_BOTTOM_THRESHOLD = 48;

export interface SessionScrollSnapshot {
  anchorEntryId: string | null;
  anchorOffset: number;
  scrollTop: number;
  stickToBottom: boolean;
}

interface PendingSessionRestore {
  sessionPath: string;
  snapshot: SessionScrollSnapshot;
  waitingForOlder: boolean;
}

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function treeEntryIdForElement(el: HTMLElement): string | null {
  if (el.dataset.treeEntryId) return el.dataset.treeEntryId;
  return el.dataset.treeEntryIds?.split(/\s+/).find(Boolean) ?? null;
}

function findTreeEntryElement(
  container: HTMLElement,
  messageId: string,
): HTMLElement | null {
  if (!messageId) return null;
  return (
    [...container.querySelectorAll<HTMLElement>(TREE_ENTRY_SELECTOR)].find(
      el => {
        if (el.dataset.treeEntryId === messageId) return true;
        return (
          el.dataset.treeEntryIds
            ?.split(/\s+/)
            .filter(Boolean)
            .includes(messageId) ?? false
        );
      },
    ) ?? null
  );
}

function isNearBottom(container: HTMLElement | null): boolean {
  if (!container) return true;
  return (
    container.scrollHeight - container.clientHeight - container.scrollTop <=
    AUTO_SCROLL_BOTTOM_THRESHOLD
  );
}

export interface ChatTranscriptScrollState {
  // state
  wasDisconnected: boolean;
  savedScrollTop: number;
  savedScrollHeight: number;
  topLoadArmed: boolean;
  shouldStickToBottom: boolean;
  pendingHistoryAnchor: {
    scrollTop: number;
    scrollHeight: number;
  } | null;
  pendingRenderSnapshot: SessionScrollSnapshot | null;
  pendingSessionRestore: PendingSessionRestore | null;
  sessionScrollSnapshots: Map<string, SessionScrollSnapshot>;

  // methods
  captureScrollSnapshot(
    container: HTMLElement | null,
  ): SessionScrollSnapshot | null;
  prepareForRender(container: HTMLElement | null): void;
  rememberSessionScroll(
    container: HTMLElement | null,
    sessionPath: string | null,
  ): void;
  preserveScroll(container: HTMLElement | null): void;
  restoreScroll(container: HTMLElement | null): void;
  scrollToBottom(container: HTMLElement | null): void;
  scrollToMessageId(container: HTMLElement | null, messageId: string): boolean;
  handleScroll(
    container: HTMLElement | null,
    opts: {
      hasOlder: boolean;
      initialLoading: boolean;
      pageLoading: boolean;
      onLoadOlder: () => void;
    },
  ): void;
  requestOlderTranscript(
    container: HTMLElement | null,
    opts: {
      hasOlder: boolean;
      initialLoading: boolean;
      pageLoading: boolean;
      onLoadOlder: () => void;
    },
  ): void;
  syncViewportAfterRender(
    container: HTMLElement | null,
    opts: {
      sessionPath: string | null;
      hasOlder: boolean;
      initialLoading: boolean;
      pageLoading: boolean;
      onLoadOlder: () => void;
    },
  ): Promise<void>;
}

export function createChatTranscriptScrollState(): ChatTranscriptScrollState {
  let wasDisconnected = false;
  let savedScrollTop = 0;
  let savedScrollHeight = 0;
  let topLoadArmed = true;
  let shouldStickToBottom = true;
  let pendingHistoryAnchor: {
    scrollTop: number;
    scrollHeight: number;
  } | null = null;
  let pendingRenderSnapshot: SessionScrollSnapshot | null = null;
  let pendingSessionRestore: PendingSessionRestore | null = null;
  const sessionScrollSnapshots = new Map<string, SessionScrollSnapshot>();

  function captureScrollSnapshot(
    container: HTMLElement | null,
  ): SessionScrollSnapshot | null {
    if (!container) return null;
    const rootRect = container.getBoundingClientRect();
    const anchorElement = [
      ...container.querySelectorAll<HTMLElement>(TREE_ENTRY_SELECTOR),
    ].find(el => el.getBoundingClientRect().bottom > rootRect.top);
    return {
      anchorEntryId: anchorElement
        ? treeEntryIdForElement(anchorElement)
        : null,
      anchorOffset: anchorElement
        ? anchorElement.getBoundingClientRect().top - rootRect.top
        : 0,
      scrollTop: container.scrollTop,
      stickToBottom: isNearBottom(container),
    };
  }

  function rememberSessionScroll(
    container: HTMLElement | null,
    sessionPath: string | null,
  ) {
    if (!sessionPath) return;
    const snapshot = captureScrollSnapshot(container);
    if (!snapshot) return;
    sessionScrollSnapshots.set(sessionPath, snapshot);
  }

  function prepareForRender(container: HTMLElement | null) {
    pendingRenderSnapshot = captureScrollSnapshot(container);
  }

  function preserveScroll(container: HTMLElement | null) {
    if (!container) return;
    rememberSessionScroll(container, null); // uses current sessionPath from outer scope
    savedScrollTop = container.scrollTop;
    savedScrollHeight = container.scrollHeight;
    wasDisconnected = true;
  }

  function restoreScroll(container: HTMLElement | null) {
    if (!container || !wasDisconnected) return;
    const delta = container.scrollHeight - savedScrollHeight;
    container.scrollTop = savedScrollTop + delta;
    shouldStickToBottom = isNearBottom(container);
    wasDisconnected = false;
  }

  function scrollToBottom(container: HTMLElement | null) {
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    shouldStickToBottom = true;
  }

  function restoreSnapshotByAnchor(
    container: HTMLElement,
    snapshot: SessionScrollSnapshot,
  ): boolean {
    if (!snapshot.anchorEntryId) return false;
    const target = findTreeEntryElement(container, snapshot.anchorEntryId);
    if (!target) return false;
    const rootRect = container.getBoundingClientRect();
    const targetTop = target.getBoundingClientRect().top - rootRect.top;
    container.scrollTop += targetTop - snapshot.anchorOffset;
    shouldStickToBottom = isNearBottom(container);
    return true;
  }

  function restoreSnapshotByScrollTop(
    container: HTMLElement,
    snapshot: SessionScrollSnapshot,
  ) {
    const maxScrollTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight,
    );
    container.scrollTop = Math.min(maxScrollTop, snapshot.scrollTop);
    shouldStickToBottom = isNearBottom(container);
  }

  function tryRestorePendingSessionScroll(
    container: HTMLElement | null,
    opts: {
      sessionPath: string | null;
      hasOlder: boolean;
      initialLoading: boolean;
      pageLoading: boolean;
      onLoadOlder: () => void;
    },
  ): boolean {
    const pending = pendingSessionRestore;
    if (!pending || opts.sessionPath !== pending.sessionPath) return false;
    if (pending.snapshot.stickToBottom) {
      scrollToBottom(container);
      pendingSessionRestore = null;
      return true;
    }
    if (opts.pageLoading || opts.initialLoading) return true;
    pending.waitingForOlder = false;
    if (container && restoreSnapshotByAnchor(container, pending.snapshot)) {
      pendingSessionRestore = null;
      return true;
    }
    if (
      pending.snapshot.anchorEntryId &&
      opts.hasOlder &&
      !pending.waitingForOlder
    ) {
      pending.waitingForOlder = true;
      opts.onLoadOlder();
      return true;
    }
    if (container) restoreSnapshotByScrollTop(container, pending.snapshot);
    pendingSessionRestore = null;
    return true;
  }

  async function syncViewportAfterRender(
    container: HTMLElement | null,
    opts: {
      sessionPath: string | null;
      hasOlder: boolean;
      initialLoading: boolean;
      pageLoading: boolean;
      onLoadOlder: () => void;
    },
  ) {
    await tick();
    if (pendingHistoryAnchor && container) {
      const delta = container.scrollHeight - pendingHistoryAnchor.scrollHeight;
      container.scrollTop = pendingHistoryAnchor.scrollTop + delta;
      shouldStickToBottom = isNearBottom(container);
      pendingHistoryAnchor = null;
      pendingRenderSnapshot = null;
      return;
    }
    if (tryRestorePendingSessionScroll(container, opts)) {
      pendingRenderSnapshot = null;
      return;
    }
    if (wasDisconnected) {
      restoreScroll(container);
      pendingRenderSnapshot = null;
      return;
    }
    if (
      container &&
      pendingRenderSnapshot &&
      !pendingRenderSnapshot.stickToBottom
    ) {
      if (!restoreSnapshotByAnchor(container, pendingRenderSnapshot)) {
        restoreSnapshotByScrollTop(container, pendingRenderSnapshot);
      }
      pendingRenderSnapshot = null;
      return;
    }
    pendingRenderSnapshot = null;
    if (shouldStickToBottom) scrollToBottom(container);
  }

  function scrollToMessageId(
    container: HTMLElement | null,
    messageId: string,
  ): boolean {
    if (!container) return false;
    const target = findTreeEntryElement(container, messageId);
    if (!target) return false;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  }

  function handleScroll(
    container: HTMLElement | null,
    opts: {
      hasOlder: boolean;
      initialLoading: boolean;
      pageLoading: boolean;
      onLoadOlder: () => void;
    },
  ) {
    shouldStickToBottom = isNearBottom(container);
    maybeLoadOlderTranscript(container, opts);
  }

  function requestOlderTranscript(
    container: HTMLElement | null,
    opts: {
      hasOlder: boolean;
      initialLoading: boolean;
      pageLoading: boolean;
      onLoadOlder: () => void;
    },
  ) {
    if (!container) return;
    if (!opts.hasOlder || opts.initialLoading || opts.pageLoading) return;
    pendingHistoryAnchor = {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
    };
    topLoadArmed = false;
    opts.onLoadOlder();
  }

  function maybeLoadOlderTranscript(
    container: HTMLElement | null,
    opts: {
      hasOlder: boolean;
      initialLoading: boolean;
      pageLoading: boolean;
      onLoadOlder: () => void;
    },
  ) {
    if (!container) return;
    if (!opts.hasOlder || opts.initialLoading || opts.pageLoading) return;
    if (container.scrollTop > TOP_LOAD_THRESHOLD) {
      topLoadArmed = true;
      return;
    }
    if (!topLoadArmed) return;
    requestOlderTranscript(container, opts);
  }

  return {
    get wasDisconnected() {
      return wasDisconnected;
    },
    set wasDisconnected(v: boolean) {
      wasDisconnected = v;
    },
    get savedScrollTop() {
      return savedScrollTop;
    },
    set savedScrollTop(v: number) {
      savedScrollTop = v;
    },
    get savedScrollHeight() {
      return savedScrollHeight;
    },
    set savedScrollHeight(v: number) {
      savedScrollHeight = v;
    },
    get topLoadArmed() {
      return topLoadArmed;
    },
    set topLoadArmed(v: boolean) {
      topLoadArmed = v;
    },
    get shouldStickToBottom() {
      return shouldStickToBottom;
    },
    set shouldStickToBottom(v: boolean) {
      shouldStickToBottom = v;
    },
    get pendingHistoryAnchor() {
      return pendingHistoryAnchor;
    },
    set pendingHistoryAnchor(v: typeof pendingHistoryAnchor) {
      pendingHistoryAnchor = v;
    },
    get pendingRenderSnapshot() {
      return pendingRenderSnapshot;
    },
    set pendingRenderSnapshot(v: typeof pendingRenderSnapshot) {
      pendingRenderSnapshot = v;
    },
    get pendingSessionRestore() {
      return pendingSessionRestore;
    },
    set pendingSessionRestore(v: typeof pendingSessionRestore) {
      pendingSessionRestore = v;
    },
    get sessionScrollSnapshots() {
      return sessionScrollSnapshots;
    },
    captureScrollSnapshot,
    prepareForRender,
    rememberSessionScroll,
    preserveScroll,
    restoreScroll,
    scrollToBottom,
    scrollToMessageId,
    handleScroll,
    requestOlderTranscript,
    syncViewportAfterRender,
  };
}
