<script setup lang="ts">
import type {
  RpcGitRepoState,
  RpcImageContent,
  RpcQueuedMessage,
  RpcSessionState,
  RpcSessionStats,
  RpcSlashCommand,
  RpcThinkingLevel,
  RpcWorkspaceEntry,
} from "@pi-web/bridge/types";
import { ref } from "vue";
import ChatTranscript from "../components/ChatTranscript.vue";
import CompatWarning from "../components/CompatWarning.vue";
import ComposerBar from "../components/ComposerBar.vue";
import SessionStatsBar from "../components/SessionStatsBar.vue";
import type {
  ConnectionStatus,
  TranscriptEntry,
} from "../composables/useBridgeClient";
import type { RpcModelInfo } from "../utils/models";
import type { PendingTranscriptSessionEvent } from "../utils/transcript";

defineProps<{
  compatWarningVisible: boolean;
  statusEntries: Record<string, string>;
  activeSessionPath: string | null;
  transcript: readonly TranscriptEntry[];
  transcriptHasOlder: boolean;
  transcriptInitialLoading: boolean;
  transcriptPageLoading: boolean;
  pendingTranscriptConfigEvent: PendingTranscriptSessionEvent | null;
  isStreaming: boolean;
  isCompacting: boolean;
  isDebugMode: boolean;
  connectionStatus: ConnectionStatus;
  commands: readonly RpcSlashCommand[];
  workspaceEntries: readonly RpcWorkspaceEntry[];
  workspaceEntriesLoading: boolean;
  ensureWorkspaceEntries: (force?: boolean) => Promise<RpcWorkspaceEntry[]>;
  workspaceContextKey: string | null;
  availableModels: readonly RpcModelInfo[];
  currentModel: RpcModelInfo | null;
  currentThinkingLevel: RpcThinkingLevel | null;
  autoCompactionEnabled: boolean;
  sessionStats: RpcSessionStats | null;
  sessionState: RpcSessionState | null;
  gitRepoState: RpcGitRepoState | null;
  gitRepoLoading: boolean;
  gitBranchSwitching: boolean;
  refreshGitRepoState: (force?: boolean) => Promise<RpcGitRepoState | null>;
  switchGitBranch: (branchName: string) => Promise<RpcGitRepoState | null>;
  createGitBranch: (branchName: string) => Promise<RpcGitRepoState | null>;
  prefillText: string | null;
  pendingRevision: {
    entryId: string;
    text: string;
    preview: string;
    hasImages: boolean;
    images: RpcImageContent[];
  } | null;
  allowRevision: boolean;
  pendingMessageCount: number;
  queuedUserMessages: readonly RpcQueuedMessage[];
  editQueuedPayload: { text: string; images: RpcImageContent[] } | null;
}>();

const emit = defineEmits<{
  submit: [
    payload: {
      message: string;
      images: RpcImageContent[];
      revisionEntryId?: string;
      steer?: boolean;
    },
  ];
  abort: [];
  loadOlderTranscript: [];
  selectModel: [model: RpcModelInfo];
  selectThinkingLevel: [level: RpcThinkingLevel];
  toggleAutoCompaction: [enabled: boolean];
  reviseMessage: [
    payload: {
      entryId: string;
      text: string;
      preview: string;
      hasImages: boolean;
      images: RpcImageContent[];
    },
  ];
  cancelRevision: [];
  cancelQueued: [index: number];
  editQueued: [index: number];
  openFileReference: [payload: { path: string; lineNumber: number }];
}>();

const chatTranscriptRef = ref<InstanceType<typeof ChatTranscript> | null>(null);

function preserveTranscriptScroll() {
  chatTranscriptRef.value?.preserveScroll();
}

function rememberTranscriptScroll() {
  chatTranscriptRef.value?.rememberSessionScroll();
}

function scrollToTranscriptEntry(entryId: string): boolean {
  return chatTranscriptRef.value?.scrollToMessageId(entryId) ?? false;
}

defineExpose({
  preserveTranscriptScroll,
  rememberTranscriptScroll,
  scrollToTranscriptEntry,
});
</script>

<template>
  <main class="center-column">
    <CompatWarning :visible="compatWarningVisible" />

    <!-- <div v-if="Object.keys(statusEntries).length > 0" class="status-bar">
      <span
        v-for="(text, key) in statusEntries"
        :key="key"
        class="status-entry"
      >
        {{ text }}
      </span>
    </div> -->

    <ChatTranscript
      ref="chatTranscriptRef"
      :session-path="activeSessionPath"
      :messages="transcript"
      :has-older="transcriptHasOlder"
      :initial-loading="transcriptInitialLoading"
      :page-loading="transcriptPageLoading"
      :pending-transcript-config-event="pendingTranscriptConfigEvent"
      :is-streaming="isStreaming"
      :is-compacting="isCompacting"
      :show-message-ids="isDebugMode"
      :allow-revision="allowRevision"
      @load-older="emit('loadOlderTranscript')"
      @revise="emit('reviseMessage', $event)"
      @open-file-reference="emit('openFileReference', $event)"
    />
    <div v-if="queuedUserMessages.length > 0" class="queued-messages-strip">
      <div
        v-for="(queued, qIdx) in queuedUserMessages"
        :key="`queued:${queued.timestamp}:${qIdx}`"
        class="queued-message-card"
      >
        <div class="queued-message-body">
          <span class="queued-badge">Queued</span>
          <span class="queued-text">{{ queued.text }}</span>
        </div>
        <div class="queued-message-actions">
          <button
            type="button"
            class="queued-action-btn edit"
            title="Edit"
            @click="emit('editQueued', qIdx)"
          >
            Edit
          </button>
          <button
            type="button"
            class="queued-action-btn cancel"
            title="Cancel"
            @click="emit('cancelQueued', qIdx)"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <SessionStatsBar
      :stats="sessionStats"
      :git-branch="sessionState?.gitBranch ?? null"
      :workspace-environments="sessionState?.workspaceEnvironments ?? []"
      :git-repo-state="gitRepoState"
      :git-repo-loading="gitRepoLoading"
      :git-branch-switching="gitBranchSwitching"
      :git-actions-disabled="
        connectionStatus !== 'connected' || isStreaming || isCompacting
      "
      :refresh-git-repo-state="refreshGitRepoState"
      :switch-git-branch="switchGitBranch"
      :create-git-branch="createGitBranch"
    />

    <ComposerBar
      :connection-status="connectionStatus"
      :is-streaming="isStreaming"
      :commands="commands"
      :workspace-entries="workspaceEntries"
      :workspace-entries-loading="workspaceEntriesLoading"
      :workspace-context-key="workspaceContextKey"
      :ensure-workspace-entries="ensureWorkspaceEntries"
      :models="availableModels"
      :selected-model="currentModel"
      :thinking-level="currentThinkingLevel"
      :auto-compaction-enabled="autoCompactionEnabled"
      :prefill-text="prefillText"
      :revision="pendingRevision"
      :pending-message-count="pendingMessageCount"
      :edit-queued-payload="editQueuedPayload"
      @submit="emit('submit', $event)"
      @abort="emit('abort')"
      @cancel-revision="emit('cancelRevision')"
      @select-model="emit('selectModel', $event)"
      @select-thinking-level="emit('selectThinkingLevel', $event)"
      @toggle-auto-compaction="emit('toggleAutoCompaction', $event)"
    />
  </main>
</template>

<style scoped>
.center-column {
  grid-column: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
}

.status-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 24px 0;
  flex-shrink: 0;
}

.status-entry {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  font-size: 0.68rem;
  color: var(--text-subtle);
}

.queued-messages-strip {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 24px;
  flex-shrink: 0;
}

.queued-message-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 14px;
  border: 1px dashed color-mix(in srgb, var(--border-strong) 60%, transparent);
  background: color-mix(in srgb, var(--panel-2) 60%, transparent);
  animation: queued-slide-in 0.25s ease;
  width: min(960px, 100%);
  margin: 0 auto;
  box-sizing: border-box;
}

@keyframes queued-slide-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.queued-message-body {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.queued-badge {
  flex-shrink: 0;
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  background: color-mix(in srgb, var(--panel) 60%, transparent);
}

.queued-text {
  font-size: 0.86rem;
  line-height: 1.5;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queued-message-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.queued-action-btn {
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: color-mix(in srgb, var(--panel) 70%, transparent);
  color: var(--text-subtle);
  font-size: 0.68rem;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    color 0.12s ease,
    background 0.12s ease;
}

.queued-action-btn:hover {
  border-color: var(--border-strong);
  background: var(--panel-2);
  color: var(--text);
}

.queued-action-btn.edit:hover {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--border-strong));
  color: var(--accent-hover);
}

.queued-action-btn.cancel:hover {
  border-color: color-mix(in srgb, var(--danger) 60%, var(--border-strong));
  color: var(--danger);
}

@media (max-width: 900px) {
  .center-column {
    grid-column: 1;
  }

  .status-bar {
    padding: 12px 16px 0;
  }
}
</style>
