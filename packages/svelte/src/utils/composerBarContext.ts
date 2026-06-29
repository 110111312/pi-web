import {
  applySlashCommandCompletion,
  debugSlashCommandOptions,
  getSlashCommandContext,
  mergeSlashCommandOptions,
  slashCommandOptionsFromRpc,
} from "./slashCommands";
import {
  applyWorkspaceMentionCompletion,
  getWorkspaceMentionContext,
  getWorkspaceMentionSuggestions,
  type WorkspaceMentionSuggestion,
} from "./workspaceMentions";
import type {
  RpcSlashCommand,
  RpcWorkspaceEntry,
} from "@pi-web/bridge/types";
import type { ComposerBarReactive } from "../components/composerBarState.svelte";

export const MAX_TEXTAREA_HEIGHT = 160;
export const TEXTAREA_HEIGHT_BUFFER = 4;

// ---------------------------------------------------------------------------
// Pure helpers — context key derivation
// ---------------------------------------------------------------------------

export function getCommandKey(
  ctx: ReturnType<typeof getSlashCommandContext> | null,
): string | null {
  if (!ctx) return null;
  return `${ctx.start}:${ctx.query}`;
}

export function getMentionKey(
  ctx: ReturnType<typeof getWorkspaceMentionContext> | null,
): string | null {
  if (!ctx) return null;
  return `${ctx.start}:${ctx.prefix}`;
}

// ---------------------------------------------------------------------------
// Context slice — slash command + workspace mention palettes
// ---------------------------------------------------------------------------

export interface ContextSliceProps {
  readonly isDebugMode: boolean;
  readonly commands: readonly RpcSlashCommand[];
  readonly workspaceEntries: readonly RpcWorkspaceEntry[];
  readonly workspaceEntriesLoading: boolean;
  readonly workspaceContextKey: string | null;
  readonly ensureWorkspaceEntries: (force?: boolean) => Promise<unknown>;
}

export interface ContextSlice {
  readonly availableSlashCommands: ReturnType<
    typeof slashCommandOptionsFromRpc
  >;
  readonly commandContext: ReturnType<typeof getSlashCommandContext>;
  readonly filteredSlashCommands: ReturnType<typeof slashCommandOptionsFromRpc>;
  readonly mentionContext: ReturnType<typeof getWorkspaceMentionContext>;
  readonly mentionSuggestions: readonly WorkspaceMentionSuggestion[];
  readonly showCommandPalette: boolean;
  readonly showMentionPalette: boolean;

  handleCommandSelect(
    commandName: string,
    textareaEl?: HTMLTextAreaElement | null,
  ): void;
  handleCommandClose(): void;
  resetDismissedPalettes(): void;
  handleMentionSelect(
    item: WorkspaceMentionSuggestion,
    textareaEl?: HTMLTextAreaElement | null,
  ): void;
  handleMentionClose(): void;

  /** Apply current context state to the textarea (cursor + resize). */
  applyContextToTextarea(
    textareaEl: HTMLTextAreaElement | null | undefined,
    text: string,
    cursor: number,
    dismissPalettes?: boolean,
  ): void;
}

export function createContextSlice(
  $rx: ComposerBarReactive,
  props: ContextSliceProps,
  isDisabled: () => boolean,
): ContextSlice {
  let dismissedCommandKey = $state<string | null>(null);
  let dismissedMentionKey = $state<string | null>(null);
  let mentionInteractionWorkspaceKey = $state<string | null>(null);

  let availableSlashCommands = $derived.by(() => {
    const baseCommands = props.isDebugMode
      ? debugSlashCommandOptions()
      : slashCommandOptionsFromRpc(props.commands);
    return mergeSlashCommandOptions(
      baseCommands,
      props.isDebugMode ? [] : undefined,
    );
  });

  let commandContext = $derived(
    getSlashCommandContext($rx.inputText, $rx.cursorOffset),
  );

  let filteredSlashCommands = $derived.by(() => {
    if (!commandContext) return [];
    const query = commandContext.query.toLowerCase();
    if (!query) return availableSlashCommands;
    return availableSlashCommands.filter(
      c =>
        c.name.toLowerCase().includes(query) ||
        (c.description ?? "").toLowerCase().includes(query),
    );
  });

  let mentionContext = $derived(
    getWorkspaceMentionContext($rx.inputText, $rx.cursorOffset),
  );

  let mentionSuggestions = $derived.by(() => {
    if (!mentionContext) return [];
    return getWorkspaceMentionSuggestions(
      props.workspaceEntries,
      mentionContext,
    );
  });

  let showCommandPalette = $derived.by(() => {
    if (isDisabled() || !commandContext) return false;
    return dismissedCommandKey !== getCommandKey(commandContext);
  });

  let showMentionPalette = $derived.by(() => {
    if (showCommandPalette || !mentionContext) return false;
    if (dismissedMentionKey === getMentionKey(mentionContext)) return false;
    if (props.workspaceEntriesLoading) return true;
    return true;
  });

  function applyContextToTextarea(
    textareaEl: HTMLTextAreaElement | null | undefined,
    text: string,
    cursor: number,
    dismissPalettes = true,
  ) {
    $rx.inputText = text;
    if (dismissPalettes) {
      dismissedCommandKey = null;
      dismissedMentionKey = null;
    }
    queueMicrotask(() => {
      const el = textareaEl;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
      $rx.cursorOffset = cursor;
      const lineHeight =
        Number.parseFloat(window.getComputedStyle(el).lineHeight) || 0;
      const pt = Number.parseFloat(window.getComputedStyle(el).paddingTop) || 0;
      const pb =
        Number.parseFloat(window.getComputedStyle(el).paddingBottom) || 0;
      const minHeight = Math.ceil(
        lineHeight + pt + pb + TEXTAREA_HEIGHT_BUFFER,
      );
      el.style.height = "auto";
      const nextHeight = Math.min(
        Math.max(el.scrollHeight + TEXTAREA_HEIGHT_BUFFER, minHeight),
        MAX_TEXTAREA_HEIGHT,
      );
      el.style.height = `${nextHeight}px`;
      el.style.overflowY =
        el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
    });
  }

  function handleCommandSelect(
    commandName: string,
    textareaEl?: HTMLTextAreaElement | null,
  ) {
    const cmd = availableSlashCommands.find(c => c.name === commandName);
    const ctx = commandContext;
    if (!cmd || !ctx) return;
    const ns = applySlashCommandCompletion($rx.inputText, ctx, cmd);
    applyContextToTextarea(textareaEl, ns.text, ns.cursor);
  }

  function handleCommandClose() {
    dismissedCommandKey = getCommandKey(commandContext);
  }

  function resetDismissedPalettes() {
    dismissedCommandKey = null;
    dismissedMentionKey = null;
  }

  function handleMentionSelect(
    item: WorkspaceMentionSuggestion,
    textareaEl?: HTMLTextAreaElement | null,
  ) {
    const mention = mentionContext;
    if (!mention) return;
    const ns = applyWorkspaceMentionCompletion(
      $rx.inputText,
      $rx.cursorOffset,
      mention,
      item,
    );
    applyContextToTextarea(textareaEl, ns.text, ns.cursor);
  }

  function handleMentionClose() {
    dismissedMentionKey = getMentionKey(mentionContext);
  }

  // ---- effects: reset dismissed state and track mention workspace key ----

  $effect(() => {
    const cmdKey = getCommandKey(commandContext);
    if (cmdKey && cmdKey !== (dismissedCommandKey ?? undefined)) {
      dismissedCommandKey = null;
    }
  });

  $effect(() => {
    void [mentionContext, props.workspaceContextKey];
    const mk = getMentionKey(mentionContext);
    if (mk && mk !== (dismissedMentionKey ?? undefined)) {
      dismissedMentionKey = null;
    }

    if (!mentionContext) {
      mentionInteractionWorkspaceKey = null;
      return;
    }
    const nik = `${props.workspaceContextKey ?? ""}:${mentionContext.start}`;
    if (mentionInteractionWorkspaceKey === nik) return;
    mentionInteractionWorkspaceKey = nik;
    void props.ensureWorkspaceEntries();
  });

  return {
    get availableSlashCommands() {
      return availableSlashCommands;
    },
    get commandContext() {
      return commandContext;
    },
    get filteredSlashCommands() {
      return filteredSlashCommands;
    },
    get mentionContext() {
      return mentionContext;
    },
    get mentionSuggestions() {
      return mentionSuggestions;
    },
    get showCommandPalette() {
      return showCommandPalette;
    },
    get showMentionPalette() {
      return showMentionPalette;
    },

    handleCommandSelect,
    handleCommandClose,
    resetDismissedPalettes,
    handleMentionSelect,
    handleMentionClose,
    applyContextToTextarea,
  };
}