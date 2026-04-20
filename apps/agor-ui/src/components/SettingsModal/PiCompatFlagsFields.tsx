/**
 * Pi Compat Flags Form Fields
 *
 * Shared Ant Design form fields for the Pi provider/model compat block. Both
 * PiProviderFormModal and PiModelFormModal render the same five flags —
 * keeping the rendering + codec in one place prevents the two forms drifting.
 */

import { Form, Select, Space, Switch } from 'antd';
import type { PiProviderCompat } from './piProviderPresets';

const MAX_TOKENS_FIELD_OPTIONS = [
  { value: 'max_tokens', label: 'max_tokens' },
  { value: 'max_completion_tokens', label: 'max_completion_tokens' },
];

const THINKING_FORMAT_OPTIONS = [
  { value: 'openai', label: 'openai (reasoning_effort)' },
  { value: 'zai', label: 'zai' },
  { value: 'qwen', label: 'qwen (enable_thinking)' },
  { value: 'qwen-chat-template', label: 'qwen-chat-template' },
];

/** Flat values used by AntD Form fields (AntD Form cannot bind nested objects). */
export interface PiCompatFormValues {
  compat_supportsDeveloperRole?: boolean;
  compat_supportsReasoningEffort?: boolean;
  compat_supportsUsageInStreaming?: boolean;
  compat_maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  compat_thinkingFormat?: 'openai' | 'zai' | 'qwen' | 'qwen-chat-template';
}

/** Expand a nested PiProviderCompat into the flat form value shape. */
export function compatToFormValues(compat: PiProviderCompat | undefined): PiCompatFormValues {
  return {
    compat_supportsDeveloperRole: compat?.supportsDeveloperRole,
    compat_supportsReasoningEffort: compat?.supportsReasoningEffort,
    compat_supportsUsageInStreaming: compat?.supportsUsageInStreaming,
    compat_maxTokensField: compat?.maxTokensField,
    compat_thinkingFormat: compat?.thinkingFormat,
  };
}

/** Collapse the flat form values into a PiProviderCompat, or undefined if empty. */
export function compatFromFormValues(values: PiCompatFormValues): PiProviderCompat | undefined {
  const compat: PiProviderCompat = {
    supportsDeveloperRole: values.compat_supportsDeveloperRole,
    supportsReasoningEffort: values.compat_supportsReasoningEffort,
    supportsUsageInStreaming: values.compat_supportsUsageInStreaming,
    maxTokensField: values.compat_maxTokensField,
    thinkingFormat: values.compat_thinkingFormat,
  };
  return Object.values(compat).some((value) => value !== undefined) ? compat : undefined;
}

interface PiCompatFlagsFieldsProps {
  /** Optional "Max tokens field" placeholder — "Inherit" for model-level, "Default" for provider. */
  maxTokensPlaceholder?: string;
  /** Optional "Thinking format" placeholder. */
  thinkingFormatPlaceholder?: string;
}

/**
 * Renders the shared compat fields. Must live inside an AntD <Form>.
 */
export const PiCompatFlagsFields: React.FC<PiCompatFlagsFieldsProps> = ({
  maxTokensPlaceholder = 'Inherit',
  thinkingFormatPlaceholder = 'Inherit',
}) => (
  <Space size="large" wrap align="start">
    <Form.Item
      label="Supports developer role"
      name="compat_supportsDeveloperRole"
      valuePropName="checked"
    >
      <Switch />
    </Form.Item>
    <Form.Item
      label="Supports reasoning_effort"
      name="compat_supportsReasoningEffort"
      valuePropName="checked"
    >
      <Switch />
    </Form.Item>
    <Form.Item
      label="Usage in streaming"
      name="compat_supportsUsageInStreaming"
      valuePropName="checked"
    >
      <Switch />
    </Form.Item>
    <Form.Item label="Max tokens field" name="compat_maxTokensField" style={{ width: 220 }}>
      <Select allowClear options={MAX_TOKENS_FIELD_OPTIONS} placeholder={maxTokensPlaceholder} />
    </Form.Item>
    <Form.Item label="Thinking format" name="compat_thinkingFormat" style={{ width: 220 }}>
      <Select
        allowClear
        options={THINKING_FORMAT_OPTIONS}
        placeholder={thinkingFormatPlaceholder}
      />
    </Form.Item>
  </Space>
);
