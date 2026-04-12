/**
 * Pi Agent Configuration Form
 *
 * Form section for Pi-specific configuration:
 * - Provider and model
 * - Reasoning effort
 * - Compaction mode and threshold
 * - Raw override JSON
 * - MCP server attachments
 */

import type { MCPServer } from '@agor/core/types';
import { AutoComplete, Form, Select } from 'antd';
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
  return (
    <>
      <Form.Item name={['modelConfig', 'mode']} hidden>
        <input type="hidden" />
      </Form.Item>

      <Form.Item
        name={['modelConfig', 'provider']}
        label="Provider"
        help={
          showHelpText
            ? 'Optional free-form provider name for Pi runtimes with multiple backends'
            : undefined
        }
      >
        <AutoComplete
          placeholder="e.g., anthropic, openai, local"
          options={[]}
          allowClear
          filterOption
        />
      </Form.Item>

      <Form.Item
        name={['modelConfig', 'model']}
        label="Model"
        help={showHelpText ? 'Optional exact model identifier for this Pi session' : undefined}
      >
        <AutoComplete placeholder="e.g., claude-sonnet-4-6" options={[]} allowClear filterOption />
      </Form.Item>

      <Form.Item
        name={['toolOptions', 'pi', 'reasoning_effort']}
        label="Reasoning Effort"
        help={
          showHelpText ? 'Controls how much reasoning effort Pi applies to problems' : undefined
        }
      >
        <Select
          placeholder="Select reasoning effort"
          options={REASONING_EFFORTS.map(({ value, label }) => ({
            value,
            label,
          }))}
          allowClear
        />
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
