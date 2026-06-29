<script lang="ts">
  import Check from "lucide-svelte/icons/check";
  import CornerDownLeft from "lucide-svelte/icons/corner-down-left";
  import Square from "lucide-svelte/icons/square";
  import type {
    RpcGitBranch,
    RpcGitRepoEntry,
    RpcGitRepoState,
    RpcModelInfo,
    RpcThinkingLevel,
  } from "@pi-web/bridge/types";
  import GitBranchDropdown from "./GitBranchDropdown.svelte";
  import ModelDropdown from "./ModelDropdown.svelte";
  import ThinkingLevelDropdown from "./ThinkingLevelDropdown.svelte";
  import { createComposerBarState } from "./composerBarState.svelte";

  type ComposerBarStateLike = ReturnType<typeof createComposerBarState>;

  let {
    composer,
    isDebugSession = false,
    models = [] as readonly RpcModelInfo[],
    selectedModel = null as RpcModelInfo | null,
    thinkingLevel = null as RpcThinkingLevel | null,
    autoCompactionEnabled = false,
    pendingMessageCount = 0,
    gitBranch = null as string | null,
    gitRepoState = null as RpcGitRepoState | null,
    gitRepoLoading = false,
    gitBranchSwitching = false,
    gitActionsDisabled = false,
    gitRepos = [] as readonly RpcGitRepoEntry[],
    gitReposLoading = false,
    gitRepoStateByRoot = {} as Readonly<Record<string, RpcGitRepoState>>,
    gitRepoStateLoadingByRoot = {} as Readonly<Record<string, boolean>>,
    selectedGitRepoRoot = null as string | null,
    refreshGitRepoStateForSingleRepo = (_?: boolean) =>
      Promise.resolve(null as RpcGitRepoState | null),
    refreshGitRepoState = (_?: string | null, __?: boolean) =>
      Promise.resolve(null as RpcGitRepoState | null),
    switchGitBranch = (_: string, __?: string | null) =>
      Promise.resolve(null as RpcGitRepoState | null),
    createGitBranch = (_: string, __?: string | null) =>
      Promise.resolve(null as RpcGitRepoState | null),
    onPickGitRepo = (_: string | null) => {},
    onPickGitBranch = (_: string, __: RpcGitBranch) => Promise.resolve(),
    onCreateGitBranch = (_: string, __: string) => Promise.resolve(),
    onSelectModel = (_: RpcModelInfo) => {},
    onSelectThinkingLevel = (_: RpcThinkingLevel) => {},
    onPrimaryAction = () => {},
  }: {
    composer: ComposerBarStateLike;
    isDebugSession?: boolean;
    models?: readonly RpcModelInfo[];
    selectedModel?: RpcModelInfo | null;
    thinkingLevel?: RpcThinkingLevel | null;
    autoCompactionEnabled?: boolean;
    pendingMessageCount?: number;
    gitBranch?: string | null;
    gitRepoState?: RpcGitRepoState | null;
    gitRepoLoading?: boolean;
    gitBranchSwitching?: boolean;
    gitActionsDisabled?: boolean;
    gitRepos?: readonly RpcGitRepoEntry[];
    gitReposLoading?: boolean;
    gitRepoStateByRoot?: Readonly<Record<string, RpcGitRepoState>>;
    gitRepoStateLoadingByRoot?: Readonly<Record<string, boolean>>;
    selectedGitRepoRoot?: string | null;
    refreshGitRepoStateForSingleRepo?: (force?: boolean) => Promise<RpcGitRepoState | null>;
    refreshGitRepoState?: (
      repoRoot?: string | null,
      force?: boolean,
    ) => Promise<RpcGitRepoState | null>;
    switchGitBranch?: (
      branchName: string,
      repoRoot?: string | null,
    ) => Promise<RpcGitRepoState | null>;
    createGitBranch?: (
      branchName: string,
      repoRoot?: string | null,
    ) => Promise<RpcGitRepoState | null>;
    onPickGitRepo?: (repoRoot: string | null) => void;
    onPickGitBranch?: (repoRoot: string, branch: RpcGitBranch) => Promise<void>;
    onCreateGitBranch?: (repoRoot: string, name: string) => Promise<void>;
    onSelectModel?: (model: RpcModelInfo) => void;
    onSelectThinkingLevel?: (level: RpcThinkingLevel) => void;
    onPrimaryAction?: () => void;
  } = $props();
</script>

<div class="composer-footer-row">
  <div class="composer-status-cluster">
    {#if !isDebugSession}
      <GitBranchDropdown
        label={gitBranch}
        repoState={gitRepoState}
        loading={gitRepoLoading}
        switching={gitBranchSwitching}
        disabled={gitActionsDisabled}
        refresh={refreshGitRepoStateForSingleRepo}
        switchBranch={switchGitBranch}
        createBranch={createGitBranch}
        repos={gitRepos}
        reposLoading={gitReposLoading}
        repoStateByRoot={gitRepoStateByRoot}
        repoStateLoadingByRoot={gitRepoStateLoadingByRoot}
        selectedRepoRoot={selectedGitRepoRoot}
        onPickRepo={onPickGitRepo}
        onPickBranch={onPickGitBranch}
        onCreateBranch={onCreateGitBranch}
        refreshRepoState={refreshGitRepoState}
      />
    {/if}
    <ModelDropdown
      {models}
      {selectedModel}
      label={composer.currentModelText}
      disabled={composer.isDisabled}
      onSelect={(model: RpcModelInfo) => onSelectModel(model)}
    />
    <ThinkingLevelDropdown
      value={thinkingLevel}
      disabled={composer.isDisabled}
      onSelect={(level: RpcThinkingLevel) => onSelectThinkingLevel(level)}
    />
    <button
      type="button"
      class="toggle-chip"
      class:disabled={composer.isDisabled}
      class:checked={autoCompactionEnabled}
      disabled={composer.isDisabled}
      aria-pressed={autoCompactionEnabled}
      title="Auto compact"
      onclick={composer.handleAutoCompactionToggle}
    >
      <span class="toggle-chip-icon" aria-hidden="true">
        {#if autoCompactionEnabled}
          <Check size={11} strokeWidth={2.5} />
        {/if}
      </span>
      <span class="toggle-chip-label">Auto compact</span>
    </button>
  </div>
  <div class="composer-action-cluster">
    {#if composer.attachmentSummary}
      <span class="attachment-summary">{composer.attachmentSummary}</span>
    {/if}
    {#if composer.hasPendingMessages}
      <div
        class="pending-queue-indicator"
        title={`${pendingMessageCount} message${pendingMessageCount > 1 ? "s" : ""} queued`}
      >
        <span class="pending-pulse"></span>
        <span class="pending-label">{pendingMessageCount}</span>
      </div>
    {/if}
    <button
      class="send-btn"
      class:stop={composer.showStopButton}
      disabled={composer.showStopButton ? !composer.canAbort : !composer.canSubmit}
      aria-label={composer.showStopButton ? "Stop response" : "Send message"}
      onclick={onPrimaryAction}
    >
      {#if composer.showStopButton}
        <Square class="send-icon stop-icon" aria-hidden="true" size={13} />
      {:else}
        <CornerDownLeft class="send-icon" aria-hidden="true" size={15} />
      {/if}
    </button>
  </div>
</div>

<style>
  .composer-footer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
    min-width: 0;
  }

  .composer-status-cluster,
  .composer-action-cluster {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .composer-action-cluster {
    justify-content: flex-end;
  }

  .attachment-summary {
    font-family: var(--pi-font-mono);
    font-size: 0.64rem;
    color: var(--text-subtle);
  }

  .pending-queue-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--border-strong) 60%, transparent);
    background: color-mix(in srgb, var(--panel-2) 80%, transparent);
    color: var(--text-subtle);
    font-size: 0.68rem;
    user-select: none;
  }

  .pending-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--warning);
    animation: pending-pulse 1.4s ease-in-out infinite;
  }

  .pending-label {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  @keyframes pending-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }

  .send-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 25px;
    height: 25px;
    border-radius: 12px;
    border: none;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      opacity 0.15s ease,
      transform 0.15s ease;
  }

  .send-btn:hover:not(:disabled) {
    background: var(--bg);
    transform: translateY(-1px);
  }

  .send-btn.stop {
    background: var(--bg);
    color: var(--error-text);
  }

  .send-btn.stop:hover:not(:disabled) {
    background: var(--bg);
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .toggle-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    border: none;
    background: var(--bg);
    color: var(--text-subtle);
    cursor: pointer;
    user-select: none;
    font: inherit;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease,
      transform 0.15s ease;
  }

  .toggle-chip:hover:not(.disabled) {
    background: var(--bg);
    color: var(--text);
  }

  .toggle-chip:focus-visible {
    background: var(--bg);
    color: var(--text);
    outline: none;
  }

  .toggle-chip.disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .toggle-chip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--border-strong) 72%, transparent);
    background: transparent;
    color: var(--bg);
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      color 0.15s ease;
  }

  .toggle-chip.checked {
    color: var(--text);
  }

  .toggle-chip.checked .toggle-chip-icon {
    border-color: color-mix(in srgb, var(--text) 72%, transparent);
    background: var(--text);
    color: var(--bg);
  }

  .toggle-chip-label {
    font-family: var(--pi-font-sans);
    font-size: 0.66rem;
    white-space: nowrap;
  }

  @media (max-width: 900px) {
    .composer-footer-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
    }

    .composer-status-cluster {
      min-width: 0;
      padding-bottom: 2px;
      scrollbar-width: none;
    }

    .composer-status-cluster::-webkit-scrollbar {
      display: none;
    }

    .composer-action-cluster {
      flex-shrink: 0;
      justify-content: flex-end;
    }

    .attachment-summary {
      display: none;
    }
  }

  @media (max-width: 640px) {
    .composer-footer-row {
      gap: 8px;
      padding-top: 8px;
    }

    .toggle-chip {
      gap: 0;
      padding: 0 7px;
    }

    .toggle-chip-label {
      display: none;
    }

    .send-btn {
      width: 32px;
      height: 32px;
      border-radius: 10px;
    }
  }
</style>