<script setup lang="ts">
import type {
  RpcGitRepoState,
  RpcSessionStats,
  RpcWorkspaceEnvironment,
} from "@pi-web/bridge/types";
import { computed } from "vue";
import GitBranchDropdown from "./GitBranchDropdown.vue";

const props = defineProps<{
  stats: RpcSessionStats | null;
  gitBranch?: string | null;
  workspaceEnvironments?: RpcWorkspaceEnvironment[];
  gitRepoState: RpcGitRepoState | null;
  gitRepoLoading: boolean;
  gitBranchSwitching: boolean;
  gitActionsDisabled?: boolean;
  refreshGitRepoState: (force?: boolean) => Promise<RpcGitRepoState | null>;
  switchGitBranch: (branchName: string) => Promise<RpcGitRepoState | null>;
  createGitBranch: (branchName: string) => Promise<RpcGitRepoState | null>;
}>();

const contextPercent = computed(() => {
  if (!props.stats || props.stats.percent == null) return null;
  return Math.min(props.stats.percent, 100);
});

const windowLabel = computed(() => {
  if (!props.stats) return null;
  return compactTokens(props.stats.contextWindow);
});

const costLabel = computed(() => {
  if (!props.stats || props.stats.cost <= 0) return null;
  return `$${props.stats.cost.toFixed(3)}`;
});

const compactTokens = (count: number) => {
  if (count < 1_000) return `${count}`;
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
};

const inputLabel = computed(() => {
  if (!props.stats || props.stats.inputTokens <= 0) return null;
  return `↑${compactTokens(props.stats.inputTokens)}`;
});

const outputLabel = computed(() => {
  if (!props.stats || props.stats.outputTokens <= 0) return null;
  return `↓${compactTokens(props.stats.outputTokens)}`;
});

const cacheReadLabel = computed(() => {
  if (!props.stats || props.stats.cacheReadTokens <= 0) return null;
  return `R${compactTokens(props.stats.cacheReadTokens)}`;
});

const cacheWriteLabel = computed(() => {
  if (!props.stats || props.stats.cacheWriteTokens <= 0) return null;
  return `W${compactTokens(props.stats.cacheWriteTokens)}`;
});

const gitBranchLabel = computed(() => {
  const branch = props.gitBranch?.trim();
  return branch ? branch : null;
});

const workspaceEnvironments = computed(() =>
  (props.workspaceEnvironments ?? []).filter(environment =>
    Boolean(environment?.label?.trim()),
  ),
);

const hasStatsContent = computed(
  () =>
    inputLabel.value != null ||
    outputLabel.value != null ||
    cacheReadLabel.value != null ||
    cacheWriteLabel.value != null ||
    contextPercent.value != null ||
    costLabel.value != null,
);

const hasVisibleContent = computed(
  () =>
    gitBranchLabel.value != null ||
    workspaceEnvironments.value.length > 0 ||
    hasStatsContent.value,
);

const barColor = computed(() => {
  if (contextPercent.value == null) return "var(--text-subtle)";
  if (contextPercent.value < 50) return "var(--text-subtle)";
  if (contextPercent.value < 80) return "var(--warning)";
  return "var(--danger)";
});
</script>

<template>
  <div v-if="hasVisibleContent" class="stats-bar">
    <div class="stats-inner">
      <div
        v-if="gitBranchLabel || workspaceEnvironments.length > 0"
        class="stats-leading"
      >
        <GitBranchDropdown
          v-if="gitBranchLabel"
          :label="gitBranchLabel"
          :repo-state="gitRepoState"
          :loading="gitRepoLoading"
          :switching="gitBranchSwitching"
          :disabled="gitActionsDisabled"
          :refresh="refreshGitRepoState"
          :switch-branch="switchGitBranch"
          :create-branch="createGitBranch"
        />
        <div
          v-for="environment in workspaceEnvironments"
          :key="`${environment.type}:${environment.label}`"
          class="stat-chip env-chip"
          :title="environment.detail || environment.label"
        >
          <span class="stat-label env-label">{{ environment.label }}</span>
        </div>
      </div>
      <div v-if="hasStatsContent" class="stats-trailing">
        <div v-if="inputLabel" class="stat-chip token-chip">
          <span class="stat-label">{{ inputLabel }}</span>
        </div>
        <div v-if="outputLabel" class="stat-chip token-chip">
          <span class="stat-label">{{ outputLabel }}</span>
        </div>
        <div v-if="cacheReadLabel" class="stat-chip token-chip">
          <span class="stat-label">{{ cacheReadLabel }}</span>
        </div>
        <div v-if="cacheWriteLabel" class="stat-chip token-chip">
          <span class="stat-label">{{ cacheWriteLabel }}</span>
        </div>
        <div v-if="costLabel" class="stat-chip cost-chip">
          <span class="stat-label">{{ costLabel }}</span>
        </div>
        <div v-if="contextPercent != null" class="stat-chip context-chip">
          <div class="context-bar-track">
            <div
              class="context-bar-fill"
              :style="{
                width: `${contextPercent}%`,
                background: barColor,
              }"
            />
          </div>
          <span class="stat-label">
            {{ contextPercent.toFixed(1) }}%/{{ windowLabel }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 6px 24px 0;
}

.stats-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(960px, 100%);
  margin: 0 auto;
}

.stats-leading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.env-chip {
  border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, var(--panel));
}

.env-label {
  color: var(--text-subtle);
}

.stats-trailing {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
  min-width: 0;
}

.stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: color-mix(in srgb, var(--panel) 60%, transparent);
}

.context-chip {
  gap: 8px;
}

.token-chip,
.cost-chip {
  border-color: color-mix(in srgb, var(--border) 50%, transparent);
}

.context-bar-track {
  width: 48px;
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--border) 80%, transparent);
  overflow: hidden;
  flex-shrink: 0;
}

.context-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition:
    width 0.4s ease,
    background 0.3s ease;
}

.stat-label {
  font-family: var(--pi-font-sans);
  font-size: 0.64rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  white-space: nowrap;
}

.stat-dim {
  color: var(--text-subtle);
}

@media (max-width: 900px) {
  .stats-bar {
    justify-content: flex-start;
    padding: 6px 16px 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .stats-bar::-webkit-scrollbar {
    display: none;
  }

  .stats-inner {
    width: max-content;
    min-width: 100%;
    flex-wrap: nowrap;
    gap: 6px;
  }

  .stats-leading,
  .stats-trailing,
  .stat-chip {
    flex-shrink: 0;
  }

  .stats-trailing {
    width: max-content;
    margin-left: auto;
    justify-content: flex-end;
    flex-wrap: nowrap;
    gap: 6px;
  }
}

@media (max-width: 640px) {
  .stats-bar {
    padding: 4px 12px 0;
  }

  .context-bar-track {
    width: 40px;
  }
}
</style>
