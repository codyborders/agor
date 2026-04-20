import {
  AVAILABLE_CLAUDE_MODEL_ALIASES,
  CODEX_MODEL_METADATA,
  DEFAULT_CODEX_MODEL,
  GEMINI_MODELS,
  type GeminiModel,
} from '@agor/core/models';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Input, Radio, Select, Space, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { usePiRuntimeStatus } from '@/hooks/usePiRuntimeStatus';
import { type OpenCodeModelConfig, OpenCodeModelSelector } from './OpenCodeModelSelector';

export interface ModelConfig {
  mode: 'alias' | 'exact';
  model: string;
  // OpenCode-specific: provider + model
  provider?: string;
}

export interface ModelSelectorProps {
  value?: ModelConfig;
  onChange?: (config: ModelConfig) => void;
  agent?: 'claude-code' | 'codex' | 'gemini' | 'opencode' | 'copilot' | 'pi'; // Kept as 'agent' for backwards compat in prop name
  agentic_tool?: 'claude-code' | 'codex' | 'gemini' | 'opencode' | 'copilot' | 'pi';
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
  // Determine which model list to use based on agentic_tool (with backwards compat for agent prop)
  const effectiveTool = agentic_tool || agent || 'claude-code';

  // Calculate model list (needed for initial mode calculation)
  // Copilot models are discovered dynamically via listModels() — use a placeholder
  const COPILOT_MODEL_OPTIONS = [
    { id: 'default', label: 'Default', description: 'Use Copilot default model' },
  ];

  const modelList =
    effectiveTool === 'codex'
      ? CODEX_MODEL_OPTIONS
      : effectiveTool === 'gemini'
        ? GEMINI_MODEL_OPTIONS
        : effectiveTool === 'opencode'
          ? [] // OpenCode doesn't use this list
          : effectiveTool === 'copilot'
            ? COPILOT_MODEL_OPTIONS
            : AVAILABLE_CLAUDE_MODEL_ALIASES;

  // Determine initial mode based on whether the value is in the aliases list
  // If no value provided, default to 'alias' mode (recommended)
  const isValueInAliases = value?.model ? modelList.some((m) => m.id === value.model) : true; // Default to true when no value (will use alias mode)
  const initialMode = value?.mode || (isValueInAliases ? 'alias' : 'exact');

  // IMPORTANT: Call hooks unconditionally before any early returns (React rules of hooks)
  const [mode, setMode] = useState<'alias' | 'exact'>(initialMode);

  // OpenCode uses a different UI (2 dropdowns: provider + model)
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
          if (onChange) {
            onChange({
              mode: 'exact', // OpenCode always uses exact provider+model IDs
              model: openCodeConfig.model,
              provider: openCodeConfig.provider,
            });
          }
        }}
      />
    );
  }

  // Pi gets its own provider+model picker fed by the live Pi registry,
  // rather than silently falling through to Claude aliases.
  if (effectiveTool === 'pi') {
    return (
      <PiModelPicker
        value={
          value?.provider || value?.model
            ? { provider: value?.provider, model: value?.model }
            : undefined
        }
        onChange={(next) => {
          if (onChange) {
            onChange({
              mode: 'exact',
              model: next.model ?? '',
              provider: next.provider,
            });
          }
        }}
      />
    );
  }

  const handleModeChange = (newMode: 'alias' | 'exact') => {
    setMode(newMode);
    if (onChange) {
      // When switching modes, provide a default model
      let defaultModel: string;
      if (newMode === 'alias') {
        defaultModel = modelList[0].id;
      } else if (effectiveTool === 'codex') {
        defaultModel = DEFAULT_CODEX_MODEL;
      } else if (effectiveTool === 'gemini') {
        defaultModel = 'gemini-2.5-flash';
      } else if (effectiveTool === 'copilot') {
        defaultModel = 'default';
      } else {
        // claude-code (opencode is handled earlier in the component)
        defaultModel = 'claude-sonnet-4-6';
      }
      onChange({
        mode: newMode,
        model: value?.model || defaultModel,
      });
    }
  };

  const handleModelChange = (newModel: string) => {
    if (onChange) {
      onChange({
        mode,
        model: newModel,
      });
    }
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
                value={value?.model || modelList[0].id}
                onChange={handleModelChange}
                style={{ width: '100%', minWidth: 400 }}
                options={modelList.map((m) => ({
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
                placeholder={
                  effectiveTool === 'codex'
                    ? `e.g., ${DEFAULT_CODEX_MODEL}`
                    : effectiveTool === 'gemini'
                      ? 'e.g., gemini-2.5-pro'
                      : effectiveTool === 'copilot'
                        ? 'e.g., gpt-4o or claude-3.5-sonnet'
                        : 'e.g., claude-opus-4-20250514' // claude-code (opencode handled earlier)
                }
                style={{ width: '100%', minWidth: 400 }}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(255, 255, 255, 0.45)' }}>
                Enter any model ID to pin to a specific version.{' '}
                <a
                  href={
                    effectiveTool === 'codex'
                      ? 'https://platform.openai.com/docs/models'
                      : effectiveTool === 'gemini'
                        ? 'https://ai.google.dev/gemini-api/docs/models'
                        : effectiveTool === 'copilot'
                          ? 'https://github.com/features/copilot'
                          : 'https://platform.claude.com/docs/en/about-claude/models' // claude-code (opencode handled earlier)
                  }
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
  const pairs = status?.provider_model_pairs ?? [];
  const providers = Array.from(new Set(pairs.map((pair) => pair.provider))).sort();
  const modelsForProvider = value?.provider
    ? pairs.filter((pair) => pair.provider === value.provider)
    : pairs;

  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Select
        showSearch
        placeholder={loading ? 'Loading providers…' : 'Provider'}
        value={value?.provider}
        onChange={(provider) => onChange?.({ provider, model: undefined })}
        options={providers.map((provider) => ({ value: provider, label: provider }))}
        style={{ width: '100%' }}
        allowClear
      />
      <Select
        showSearch
        placeholder={loading ? 'Loading models…' : 'Model'}
        value={value?.model}
        onChange={(model) => onChange?.({ provider: value?.provider, model })}
        options={modelsForProvider.map((pair) => ({
          value: pair.id,
          label: `${pair.name}${pair.reasoning ? ' · reasoning' : ''}`,
        }))}
        style={{ width: '100%' }}
        allowClear
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Configure providers & API keys in User Settings → Pi.
      </Typography.Text>
    </Space>
  );
};
