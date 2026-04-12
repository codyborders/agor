import type { DefaultModelConfig } from '@agor/core/types';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeModelConfigFormValue(
  modelConfig: unknown
): DefaultModelConfig | undefined {
  if (!modelConfig || typeof modelConfig !== 'object') {
    return undefined;
  }

  const candidate = modelConfig as DefaultModelConfig;
  if (!isNonEmptyString(candidate.model)) {
    return undefined;
  }

  return {
    mode: candidate.mode ?? 'exact',
    model: candidate.model,
    thinkingMode: candidate.thinkingMode,
    manualThinkingTokens: candidate.manualThinkingTokens,
    provider: isNonEmptyString(candidate.provider) ? candidate.provider : undefined,
  };
}
