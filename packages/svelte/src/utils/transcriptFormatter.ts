import type {
  RpcTranscriptSystemBlock,
} from "@pi-web/bridge/types";
import type {
  PendingTranscriptSessionEvent,
  TranscriptConfigState,
  TranscriptDisplayItem,
  TranscriptEntryLike,
  TranscriptSessionEventDisplayItem,
} from "./transcriptTypes";
import {
  isHiddenSystemBlock,
  isSystemBlock,
  normalizeText,
  transcriptMessageKey,
} from "./transcriptUtils";

// Display item building

export function buildTranscriptDisplayItems(
  messages: readonly TranscriptEntryLike[],
  options?: {
    pendingSessionEvent?: PendingTranscriptSessionEvent | null;
  },
): TranscriptDisplayItem[] {
  const items: TranscriptDisplayItem[] = [];
  let hasSeenNonConfigMessage = false;
  let index = 0;

  while (index < messages.length) {
    if (isHiddenTranscriptMessage(messages[index])) {
      index += 1;
      continue;
    }

    if (!configSystemBlock(messages[index])) {
      items.push({
        kind: "message",
        message: messages[index],
        messageIndex: index,
      });
      hasSeenNonConfigMessage = true;
      index += 1;
      continue;
    }

    const startIndex = index;
    let model: ModelChangeSystemBlock | undefined;
    let thinking: ThinkingLevelChangeSystemBlock | undefined;
    const sourceMessageIds: string[] = [];

    while (index < messages.length) {
      if (isHiddenTranscriptMessage(messages[index])) {
        index += 1;
        continue;
      }

      const block = configSystemBlock(messages[index]);
      if (!block) break;

      if (block.type === "model_change") {
        model = block;
      } else {
        thinking = block;
      }

      const messageId = messages[index]?.id;
      if (typeof messageId === "string" && messageId.trim()) {
        sourceMessageIds.push(messageId);
      }
      index += 1;
    }

    const normalizedModel = model
      ? {
          provider: normalizeText(model.provider, "") || undefined,
          id: normalizeText(model.modelId, "Unknown model"),
        }
      : undefined;
    const normalizedThinkingLevel = thinking
      ? normalizeText(thinking.thinkingLevel, "Unknown")
      : undefined;

    items.push({
      kind: "session_event",
      key: sessionEventKey(messages, startIndex, index - 1),
      label: sessionEventLabel(
        hasSeenNonConfigMessage,
        Boolean(normalizedModel),
        Boolean(normalizedThinkingLevel),
      ),
      model: normalizedModel,
      thinkingLevel: normalizedThinkingLevel,
      sourceMessageIds,
    });
  }

  return insertPendingSessionEvent(items, options?.pendingSessionEvent);
}

// Config system block detection

type ConfigSystemBlock = Extract<
  RpcTranscriptSystemBlock,
  { type: "model_change" | "thinking_level_change" }
>;
type ModelChangeSystemBlock = Extract<
  RpcTranscriptSystemBlock,
  { type: "model_change" }
>;
type ThinkingLevelChangeSystemBlock = Extract<
  RpcTranscriptSystemBlock,
  { type: "thinking_level_change" }
>;

export function configSystemBlock(
  message: TranscriptEntryLike,
): ConfigSystemBlock | null {
  if (message.role !== "system" || !Array.isArray(message.content)) {
    return null;
  }
  if (message.content.length !== 1) return null;

  const [block] = message.content;
  if (typeof block !== "object" || block === null) return null;
  if (block.type !== "model_change" && block.type !== "thinking_level_change") {
    return null;
  }

  return block as ConfigSystemBlock;
}

function isHiddenTranscriptMessage(message: TranscriptEntryLike): boolean {
  if (message.role !== "system" || !Array.isArray(message.content)) {
    return false;
  }
  if (message.content.length === 0) return false;

  return message.content.every(
    block =>
      typeof block === "object" &&
      block !== null &&
      isSystemBlock(block) &&
      isHiddenSystemBlock(block),
  );
}

function sessionEventKey(
  messages: readonly TranscriptEntryLike[],
  startIndex: number,
  endIndex: number,
): string {
  const startKey = transcriptMessageKey(messages[startIndex], startIndex);
  const endKey = transcriptMessageKey(messages[endIndex], endIndex);
  return startKey === endKey
    ? `session-event:${startKey}`
    : `session-event:${startKey}-${endKey}`;
}

function sessionEventLabel(
  hasSeenNonConfigMessage: boolean,
  hasModel: boolean,
  hasThinking: boolean,
): string {
  if (!hasSeenNonConfigMessage) return "Session configured";
  if (hasModel && hasThinking) return "Settings changed";
  if (hasModel) return "Model switched";
  if (hasThinking) return "Thinking changed";
  return "Settings changed";
}

// Config state from messages

export function transcriptConfigState(
  messages: readonly TranscriptEntryLike[],
): TranscriptConfigState {
  const state: TranscriptConfigState = {};

  for (const message of messages) {
    const block = configSystemBlock(message);
    if (!block) continue;

    if (block.type === "model_change") {
      state.model = {
        provider: block.provider?.trim() ? block.provider.trim() : undefined,
        id: block.modelId.trim() ? block.modelId.trim() : "Unknown model",
      };
    } else {
      state.thinkingLevel = block.thinkingLevel.trim()
        ? block.thinkingLevel.trim()
        : "Unknown";
    }
  }

  return state;
}

// Pending session event insertion

interface TranscriptDisplayState extends TranscriptConfigState {
  hasSeenNonConfigMessage: boolean;
}

function insertPendingSessionEvent(
  items: TranscriptDisplayItem[],
  pendingEvent: PendingTranscriptSessionEvent | null | undefined,
): TranscriptDisplayItem[] {
  if (!pendingEvent || items.length === 0) return items;

  const insertIndex = pendingSessionEventInsertIndex(items, pendingEvent);
  const insertionState = displayStateBeforeIndex(items, insertIndex);
  const finalState = displayStateBeforeIndex(items, items.length);
  const pendingModel = pendingEvent.model
    ? normalizePendingSessionEventModel(pendingEvent.model)
    : undefined;
  const pendingThinkingLevel = normalizePendingSessionEventThinking(
    pendingEvent.thinkingLevel,
  );
  const nextModel =
    pendingModel &&
    !sameTranscriptModel(insertionState.model, pendingModel) &&
    !sameTranscriptModel(finalState.model, pendingModel)
      ? pendingModel
      : undefined;
  const nextThinkingLevel =
    pendingThinkingLevel &&
    pendingThinkingLevel !== insertionState.thinkingLevel &&
    pendingThinkingLevel !== finalState.thinkingLevel
      ? pendingThinkingLevel
      : undefined;

  if (!nextModel && !nextThinkingLevel) return items;

  const item: TranscriptSessionEventDisplayItem = {
    kind: "session_event",
    key: pendingEvent.key,
    label: sessionEventLabel(
      insertionState.hasSeenNonConfigMessage,
      Boolean(nextModel),
      Boolean(nextThinkingLevel),
    ),
    model: nextModel,
    thinkingLevel: nextThinkingLevel,
    sourceMessageIds: [],
  };

  const previousItem = items[insertIndex - 1];
  if (
    previousItem?.kind === "session_event" &&
    !insertionState.hasSeenNonConfigMessage
  ) {
    const mergedItem: TranscriptSessionEventDisplayItem = {
      kind: "session_event",
      key: `${previousItem.key}:${pendingEvent.key}`,
      label: item.label,
      model: item.model ?? previousItem.model,
      thinkingLevel: item.thinkingLevel ?? previousItem.thinkingLevel,
      sourceMessageIds: previousItem.sourceMessageIds,
    };
    return [
      ...items.slice(0, insertIndex - 1),
      mergedItem,
      ...items.slice(insertIndex),
    ];
  }

  return [...items.slice(0, insertIndex), item, ...items.slice(insertIndex)];
}

function pendingSessionEventInsertIndex(
  items: readonly TranscriptDisplayItem[],
  pendingEvent: PendingTranscriptSessionEvent,
): number {
  const anchorKey = pendingEvent.insertAfterMessageKey;

  if (anchorKey === null) {
    return leadingSessionEventCount(items);
  }
  if (typeof anchorKey !== "string" || !anchorKey.trim()) {
    return items.length;
  }

  const anchoredIndex = items.findIndex(item =>
    displayItemContainsMessageKey(item, anchorKey),
  );
  return anchoredIndex >= 0 ? anchoredIndex + 1 : items.length;
}

function leadingSessionEventCount(
  items: readonly TranscriptDisplayItem[],
): number {
  let index = 0;
  while (items[index]?.kind === "session_event") {
    index += 1;
  }
  return index;
}

function displayItemContainsMessageKey(
  item: TranscriptDisplayItem,
  messageKey: string,
): boolean {
  if (item.kind === "session_event") {
    return item.sourceMessageIds.includes(messageKey);
  }
  return transcriptMessageKey(item.message, item.messageIndex) === messageKey;
}

function displayStateBeforeIndex(
  items: readonly TranscriptDisplayItem[],
  index: number,
): TranscriptDisplayState {
  const state: TranscriptDisplayState = { hasSeenNonConfigMessage: false };

  for (let itemIndex = 0; itemIndex < index; itemIndex++) {
    const item = items[itemIndex];
    if (!item) continue;

    if (item.kind === "message") {
      state.hasSeenNonConfigMessage = true;
      continue;
    }
    if (item.model) {
      state.model = item.model;
    }
    if (item.thinkingLevel) {
      state.thinkingLevel = item.thinkingLevel;
    }
  }

  return state;
}

function normalizePendingSessionEventModel(value: {
  provider?: string;
  id: string;
}): {
  provider?: string;
  id: string;
} {
  return {
    provider: value.provider?.trim() ? value.provider.trim() : undefined,
    id: value.id.trim() ? value.id.trim() : "Unknown model",
  };
}

function normalizePendingSessionEventThinking(
  value: string | undefined,
): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}

function sameTranscriptModel(
  left:
    | {
        provider?: string;
        id: string;
      }
    | undefined,
  right:
    | {
        provider?: string;
        id: string;
      }
    | undefined,
): boolean {
  if (!left || !right) return false;
  return left.id === right.id && left.provider === right.provider;
}