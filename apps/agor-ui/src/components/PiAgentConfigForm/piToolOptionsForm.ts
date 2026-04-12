import type { PiToolOptions } from '@agor/core/types';

export interface PiToolOptionsFormValue {
  reasoning_effort?: string;
  compaction_mode?: 'inherit' | 'off' | 'auto' | 'manual';
  compaction_threshold_tokens?: number;
  raw_overrides?: string;
}

export interface PiToolOptionsFormState {
  pi?: PiToolOptionsFormValue;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getPiToolOptionsFormState(toolOptions?: {
  pi?: PiToolOptions;
}): PiToolOptionsFormState | undefined {
  if (!toolOptions?.pi) {
    return undefined;
  }

  return {
    pi: {
      reasoning_effort: toolOptions.pi.reasoning_effort,
      compaction_mode: toolOptions.pi.compaction_mode,
      compaction_threshold_tokens: toolOptions.pi.compaction_threshold_tokens,
      raw_overrides: toolOptions.pi.raw_overrides
        ? JSON.stringify(toolOptions.pi.raw_overrides, null, 2)
        : undefined,
    },
  };
}

export function normalizePiToolOptionsFormState(
  toolOptions: unknown
): { pi?: PiToolOptions } | undefined {
  if (!toolOptions || typeof toolOptions !== 'object') {
    return undefined;
  }

  const piValue = (toolOptions as PiToolOptionsFormState).pi;
  if (!piValue || typeof piValue !== 'object') {
    return undefined;
  }

  const normalized: PiToolOptions = {};

  if (isNonEmptyString(piValue.reasoning_effort)) {
    normalized.reasoning_effort = piValue.reasoning_effort;
  }

  if (piValue.compaction_mode) {
    normalized.compaction_mode = piValue.compaction_mode;
  }

  if (typeof piValue.compaction_threshold_tokens === 'number') {
    normalized.compaction_threshold_tokens = piValue.compaction_threshold_tokens;
  }

  if (isNonEmptyString(piValue.raw_overrides)) {
    normalized.raw_overrides = JSON.parse(piValue.raw_overrides);
  }

  if (Object.keys(normalized).length === 0) {
    return undefined;
  }

  return { pi: normalized };
}
