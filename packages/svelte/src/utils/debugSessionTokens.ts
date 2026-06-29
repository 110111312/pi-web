import { DEFAULT_DEBUG_TPS, MAX_DEBUG_TPS, MIN_DEBUG_TPS } from "./debugSessionTypes";

export function clampDebugTps(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DEBUG_TPS;
  return Math.min(MAX_DEBUG_TPS, Math.max(MIN_DEBUG_TPS, Math.round(value)));
}

export function parseDebugTps(value: string): number {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed)) {
    throw new Error("TPS must be a finite number.");
  }
  return clampDebugTps(parsed);
}

export function delayForTokens(tokenCount: number, tps: number): number {
  const normalizedTps = clampDebugTps(tps);
  const tokens = Math.max(1, Math.round(tokenCount));
  return Math.max(40, Math.round((tokens / normalizedTps) * 1000));
}

export function countApproxTokens(text: string): number {
  const matches = text.match(/```|`|[A-Za-z_][A-Za-z0-9_]*|\d+|[^\s]/g);
  return matches?.length ?? 1;
}

export function trimCommandArgument(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(fallback);
  return trimmed;
}