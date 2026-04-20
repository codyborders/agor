import {
  AVAILABLE_CLAUDE_MODEL_ALIASES,
  CODEX_MODEL_METADATA,
  DEFAULT_CODEX_MODEL,
  GEMINI_MODELS,
  type GeminiModel,
} from '@agor/core/models';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Input, Radio, Select, Space, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { usePiRuntimeStatus } from '@/hooks/usePiRuntimeStatus';
import { type OpenCodeModelConfig, OpenCodeModelSelector } from './OpenCodeModelSelector';

export interface ModelConfig {
  mode: 'alias' | 'exact';
  model: string;
  // OpenCode / Pi: provider + model
  provider?: string;
}

type AgenticToolKey = 'claude-code' | 'codex' | 'gemini' | 'opencode' | 'copilot' | 'pi';

export interface ModelSelectorProps {
  value?: ModelConfig;
  onChange?: (config: ModelConfig) => void;
  /** @deprecated Use `agentic_tool` — kept for backwards compat. */
  agent?: AgenticToolKey;
  agentic_tool?: AgenticToolKey;
}

// Codex model options (derived from @agor/core metadata)
const CODEX_MODEL_OPTIONS = Object.entries(CODEX_MODEL_METADATA).map(([modelId, meta]) => ({
  id: modelId,
  label: meta.name,
  description: meta.description,
}));

// Gemini model options (convert from GEMINI_MODELS metadata)
const GEMINI_MODEL_OPTIONS = Object.entries(GEMINI_MODELS).map(([modelId, meta]) => ({
  id: modelId as GeminiModel,
  label: meta.name,
  description: meta.description,
}));

// Copilot models are discovered dynamically via listModels() — use a placeholder.
const COPILOT_MODEL_OPTIONS = [
  { id: 'default', label: 'Default', description: 'Use Copilot default model' },
];

interface ToolMeta {
  aliasOptions: Array<{ id: string; label?: string; description?: string }>;
  exactDefault: string;
  exactPlaceholder: string;
  docsUrl: string;
}

// Centralizing per-tool UI metadata avoids nested ternaries that hid the per-
// tool matrix behind four levels of `?:`. Add a tool here instead of growing a
// conditional chain.
const TOOL_META: Record<Exclude<AgenticToolKey, 'opencode' | 'pi'>, ToolMeta> = {
  'claude-code': {
    aliasOptions: AVAILABLE_CLAUDE_MODEL_ALIASES,
    exactDefault: 'claude-sonnet-4-6',
    exactPlaceholder: 'e.g., claude-opus-4-20250514',
    docsUrl: 'https://platform.claude.com/docs/en/about-claude/models',
  },
  codex: {
    aliasOptions: CODEX_MODEL_OPTIONS,
    exactDefault: DEFAULT_CODEX_MODEL,
    exactPlaceholder: `e.g., ${DEFAULT_CODEX_MODEL}`,
    docsUrl: 'https://platform.openai.com/docs/models',
  },
  gemini: {
    aliasOptions: GEMINI_MODEL_OPTIONS,
    exactDefault: 'gemini-2.5-flash',
    exactPlaceholder: 'e.g., gemini-2.5-pro',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
  },
  copilot: {
    aliasOptions: COPILOT_MODEL_OPTIONS,
    exactDefault: 'default',
    exactPlaceholder: 'e.g., gpt-4o or claude-3.5-sonnet',
    docsUrl: 'https://github.com/features/copilot',
  },
};

/**
 * Model Selector Component
 *
 * Allows users to choose between:
 * - Model aliases (e.g., 'claude-sonnet-4-5-latest') - automatically uses latest version
 * - Exact model IDs (e.g., 'claude-sonnet-4-5-20250929') - pins to specific release
 *
 * Shows agent-specific models based on the agent prop.
 */
export const ModelSelector: React.FC<ModelSelectorProps> = ({
  value,
  onChange,
  agent,
  agentic_tool,
}) => {
  const effectiveTool: AgenticToolKey = agentic_tool || agent || 'claude-code';

  // Compute initial mode up-front so useState can be called unconditionally
  // (React hooks must not appear after an early return). For tools that use
  // their own picker below, aliasOptions is empty and mode is unused.
  const aliasOptions =
    effectiveTool === 'opencode' || effectiveTool === 'pi'
      ? []
      : TOOL_META[effectiveTool].aliasOptions;
  const isValueInAliases = value?.model ? aliasOptions.some((m) => m.id === value.model) : true;
  const initialMode = value?.mode || (isValueInAliases ? 'alias' : 'exact');
  const [mode, setMode] = useState<'alias' | 'exact'>(initialMode);

  // OpenCode and Pi use their own pickers (provider + model).
  if (effectiveTool === 'opencode') {
    return (
      <OpenCodeModelSelector
        value={
          value?.provider || value?.model
            ? {
                provider: value.provider || '',
                model: value.model || '',
              }
            : undefined
        }
        onChange={(openCodeConfig: OpenCodeModelConfig) => {
          onChange?.({
            mode: 'exact',
            model: openCodeConfig.model,
            provider: openCodeConfig.provider,
          });
        }}
      />
    );
  }

  if (effectiveTool === 'pi') {
    return (
      <PiModelPicker
        value={
          value?.provider || value?.model
            ? { provider: value?.provider, model: value?.model }
            : undefined
        }
        onChange={(next) => {
          onChange?.({
            mode: 'exact',
            model: next.model ?? '',
            provider: next.provider,
          });
        }}
      />
    );
  }

  const meta = TOOL_META[effectiveTool];

  const handleModeChange = (newMode: 'alias' | 'exact') => {
    setMode(newMode);
    if (!onChange) return;
    const defaultModel = newMode === 'alias' ? aliasOptions[0].id : meta.exactDefault;
    onChange({
      mode: newMode,
      model: value?.model || defaultModel,
    });
  };

  const handleModelChange = (newModel: string) => {
    onChange?.({ mode, model: newModel });
  };

  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Radio.Group value={mode} onChange={(e) => handleModeChange(e.target.value)}>
        <Space orientation="vertical">
          <Radio value="alias">
            <Space>
              Use model alias (recommended)
              <Tooltip title="Automatically uses the latest version of the model">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          </Radio>

          {mode === 'alias' && (
            <div style={{ marginLeft: 24, marginTop: 8 }}>
              <Select
                value={value?.model || aliasOptions[0].id}
                onChange={handleModelChange}
                style={{ width: '100%', minWidth: 400 }}
                options={aliasOptions.map((m) => ({
                  value: m.id,
                  label: m.id,
                }))}
              />
            </div>
          )}

          <Radio value="exact">
            <Space>
              Specify exact model ID
              <Tooltip title="Pin to a specific model release for reproducibility">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          </Radio>

          {mode === 'exact' && (
            <div style={{ marginLeft: 24, marginTop: 8 }}>
              <Input
                value={value?.model}
                onChange={(e) => handleModelChange(e.target.value)}
                placeholder={meta.exactPlaceholder}
                style={{ width: '100%', minWidth: 400 }}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(255, 255, 255, 0.45)' }}>
                Enter any model ID to pin to a specific version.{' '}
                <a
                  href={meta.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ fontSize: 12, color: '#1677ff' }}
                >
                  View available models
                </a>
              </div>
            </div>
          )}
        </Space>
      </Radio.Group>
    </Space>
  );
};

interface PiModelPickerProps {
  value?: { provider?: string; model?: string };
  onChange?: (next: { provider?: string; model?: string }) => void;
}

const PiModelPicker: React.FC<PiModelPickerProps> = ({ value, onChange }) => {
  const { status, loading } = usePiRuntimeStatus();
  const pairs = status?.provider_model_pairs;

  const providerOptions = useMemo(() => {
    if (!pairs) return [];
    return Array.from(new Set(pairs.map((pair) => pair.provider)))
      .sort()
      .map((provider) => ({ value: provider, label: provider }));
  }, [pairs]);

  const modelOptions = useMemo(() => {
    if (!pairs) return [];
    const scoped = value?.provider
      ? pairs.filter((pair) => pair.provider === value.provider)
      : pairs;
    return scoped.map((pair) => ({
      value: pair.id,
      label: `${pair.name}${pair.reasoning ? ' · reasoning' : ''}${
        pair.has_configured_auth ? '' : ' · no auth'
      }`,
    }));
  }, [pairs, value?.provider]);

  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Select
        showSearch
        placeholder={loading ? 'Loading providers…' : 'Provider'}
        value={value?.provider}
        onChange={(provider) => onChange?.({ provider, model: undefined })}
        options={providerOptions}
        style={{ width: '100%' }}
        allowClear
      />
      <Select
        showSearch
        placeholder={loading ? 'Loading models…' : 'Model'}
        value={value?.model}
        onChange={(model) => onChange?.({ provider: value?.provider, model })}
        options={modelOptions}
        style={{ width: '100%' }}
        allowClear
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Configure providers & API keys in User Settings → Pi.
      </Typography.Text>
    </Space>
  );
};
