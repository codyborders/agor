/**
 * Pi Agent Configuration Form
 *
 * Form section for Pi-specific configuration:
 * - Provider and model (populated from the live Pi model registry)
 * - Reasoning effort
 * - Compaction mode and threshold
 * - Raw override JSON
 * - MCP server attachments
 */

import type { MCPServer } from '@agor/core/types';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Form, Select, Tooltip, Typography } from 'antd';
import { useMemo } from 'react';
import { usePiRuntimeStatus } from '@/hooks/usePiRuntimeStatus';
import { mapToArray } from '@/utils/mapHelpers';
import { JSONEditor, validateJSON } from '../JSONEditor';
import { MCPServerSelect } from '../MCPServerSelect';

export interface PiAgentConfigFormProps {
  /** Available MCP servers */
  mcpServerById: Map<string, MCPServer>;
  /** Whether to show help text under each field */
  showHelpText?: boolean;
  /** Compact mode for edit contexts */
  compact?: boolean;
}

const COMPACTION_MODES = [
  { value: 'inherit', label: 'Inherit', description: 'Use worktree/project settings' },
  { value: 'off', label: 'Off', description: 'Disable compaction' },
  { value: 'auto', label: 'Auto', description: 'Enable automatic compaction' },
  { value: 'manual', label: 'Manual', description: 'User-controlled via explicit command' },
];

const REASONING_EFFORTS = [
  { value: 'default', label: 'Default' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const COMPACTION_THRESHOLDS = [50000, 100000, 150000, 200000];

export const PiAgentConfigForm: React.FC<PiAgentConfigFormProps> = ({
  mcpServerById,
  showHelpText = true,
  compact = false,
}) => {
  const { status, loading } = usePiRuntimeStatus();
  const form = Form.useFormInstance();
  const selectedProvider = Form.useWatch(['modelConfig', 'provider'], form) as string | undefined;

  // Memoize on the pairs array identity (stable across renders unless the
  // hook refreshes) instead of the outer `status` object — which the hook
  // can reallocate even when the underlying data is unchanged.
  const pairs = status?.provider_model_pairs;

  const { providerOptions, modelOptionsByProvider, allModelOptions } = useMemo(() => {
    const list = pairs ?? [];
    const providerMeta = new Map<string, { configured: boolean; modelCount: number }>();
    const modelsByProvider = new Map<string, Array<{ value: string; label: string }>>();

    for (const pair of list) {
      const meta = providerMeta.get(pair.provider) ?? { configured: false, modelCount: 0 };
      meta.modelCount += 1;
      meta.configured = meta.configured || pair.has_configured_auth;
      providerMeta.set(pair.provider, meta);

      const modelList = modelsByProvider.get(pair.provider) ?? [];
      const contextLabel = pair.context_window
        ? ` · ${Math.round(pair.context_window / 1000)}k ctx`
        : '';
      const reasoningLabel = pair.reasoning ? ' · reasoning' : '';
      modelList.push({
        value: pair.id,
        label: `${pair.name}${contextLabel}${reasoningLabel}`,
      });
      modelsByProvider.set(pair.provider, modelList);
    }

    const providers = Array.from(providerMeta.entries())
      .map(([provider, meta]) => ({
        value: provider,
        label: `${provider} · ${meta.modelCount} model${meta.modelCount === 1 ? '' : 's'}${
          meta.configured ? '' : ' · no auth'
        }`,
      }))
      .sort((first, second) => first.value.localeCompare(second.value));

    const allModels = list
      .map((pair) => ({
        value: pair.id,
        label: `${pair.provider} / ${pair.name}`,
      }))
      .sort((first, second) => first.label.localeCompare(second.label));

    return {
      providerOptions: providers,
      modelOptionsByProvider: modelsByProvider,
      allModelOptions: allModels,
    };
  }, [pairs]);

  const modelOptions = useMemo(() => {
    return (selectedProvider && modelOptionsByProvider.get(selectedProvider)) || allModelOptions;
  }, [selectedProvider, modelOptionsByProvider, allModelOptions]);

  const helpSuffix = loading ? ' · loading registry…' : '';

  let modelHelp: string | undefined;
  if (showHelpText) {
    modelHelp = selectedProvider
      ? `Models offered by ${selectedProvider}.${helpSuffix}`
      : `All registered Pi models. Pick a provider to narrow the list.${helpSuffix}`;
  }

  return (
    <>
      {/* Pi always uses exact provider+model ids; `mode` is stored for parity
          with the claude-code/codex/gemini model config shape. */}
      <Form.Item name={['modelConfig', 'mode']} hidden initialValue="exact">
        <input type="hidden" />
      </Form.Item>

      <Form.Item
        name={['modelConfig', 'provider']}
        label={
          <span>
            Provider
            <Tooltip
              title={
                <span>
                  Pi ships with built-in providers (anthropic, openai, google, minimax, zai, …). Add
                  more in <b>User Settings → Pi Custom Providers</b> and paste keys in{' '}
                  <b>Pi API Keys</b>.
                </span>
              }
            >
              <InfoCircleOutlined style={{ marginLeft: 6 }} />
            </Tooltip>
          </span>
        }
        help={
          showHelpText
            ? `Pick the Pi provider (auth must be configured in Pi API Keys).${helpSuffix}`
            : undefined
        }
      >
        <Select
          showSearch
          virtual
          placeholder="e.g. anthropic, minimax, zai, llama-cpp"
          options={providerOptions}
          allowClear
          optionFilterProp="label"
        />
      </Form.Item>

      <Form.Item name={['modelConfig', 'model']} label="Model" help={modelHelp}>
        <Select
          showSearch
          virtual
          placeholder="e.g. glm-5.1, MiniMax-M2.7, claude-sonnet-4-6"
          options={modelOptions}
          allowClear
          optionFilterProp="label"
        />
      </Form.Item>

      {!compact && (pairs?.length ?? 0) === 0 && (
        <Typography.Paragraph type="secondary" style={{ marginTop: -8, fontSize: 12 }}>
          No models found. Set at least one provider API key in User Settings → Pi API Keys, or add
          a custom provider in User Settings → Pi Custom Providers.
        </Typography.Paragraph>
      )}

      <Form.Item
        name={['toolOptions', 'pi', 'reasoning_effort']}
        label="Reasoning Effort"
        help={
          showHelpText ? 'Controls how much reasoning effort Pi applies to problems' : undefined
        }
      >
        <Select placeholder="Select reasoning effort" options={REASONING_EFFORTS} allowClear />
      </Form.Item>

      {!compact && (
        <Form.Item
          name={['toolOptions', 'pi', 'compaction_mode']}
          label="Compaction Mode"
          help={showHelpText ? 'Controls how Pi handles context window pressure' : undefined}
        >
          <Select
            placeholder="Select compaction mode"
            options={COMPACTION_MODES.map(({ value, label, description }) => ({
              value,
              label: `${label} · ${description}`,
            }))}
            allowClear
          />
        </Form.Item>
      )}

      {!compact && (
        <Form.Item
          name={['toolOptions', 'pi', 'compaction_threshold_tokens']}
          label="Compaction Threshold (tokens)"
          help={showHelpText ? 'Token count that triggers automatic compaction' : undefined}
        >
          <Select
            placeholder="Select threshold"
            options={COMPACTION_THRESHOLDS.map((threshold) => ({
              value: threshold,
              label: `${threshold.toLocaleString()} tokens`,
            }))}
            allowClear
          />
        </Form.Item>
      )}

      {!compact && (
        <Form.Item
          name={['toolOptions', 'pi', 'raw_overrides']}
          label="Raw Overrides (JSON)"
          help={
            showHelpText
              ? 'Advanced: JSON object merged directly into Pi session config'
              : undefined
          }
          rules={[{ validator: validateJSON }]}
        >
          <JSONEditor placeholder='{"key": "value"}' rows={4} />
        </Form.Item>
      )}

      <Form.Item
        name="mcpServerIds"
        label="MCP Servers"
        help={showHelpText ? 'Select MCP servers to make available in this Pi session' : undefined}
      >
        <MCPServerSelect
          mcpServers={mapToArray(mcpServerById)}
          placeholder="No MCP servers attached"
        />
      </Form.Item>
    </>
  );
};
