/**
 * Pi Model Form Modal
 *
 * Add/edit a single model inside a Pi custom provider. Fields mirror the
 * `models.json` schema documented in the Pi SDK's docs/models.md:
 * id (required), name, reasoning, input, contextWindow, maxTokens, cost, compat.
 */

import { Form, Input, InputNumber, Modal, Select, Space, Switch, Typography } from 'antd';
import { useEffect } from 'react';
import type { PiModelDraft } from './piProviderPresets';

interface PiModelFormModalProps {
  open: boolean;
  initial?: PiModelDraft;
  onCancel: () => void;
  onSubmit: (model: PiModelDraft) => void;
  existingIds: string[];
}

interface FormValues {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  contextWindow?: number;
  maxTokens?: number;
  cost_input?: number;
  cost_output?: number;
  cost_cacheRead?: number;
  cost_cacheWrite?: number;
  compat_supportsDeveloperRole?: boolean;
  compat_supportsReasoningEffort?: boolean;
  compat_supportsUsageInStreaming?: boolean;
  compat_maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  compat_thinkingFormat?: 'openai' | 'zai' | 'qwen' | 'qwen-chat-template';
}

function toFormValues(model: PiModelDraft | undefined): FormValues {
  if (!model) {
    return { input: ['text'], reasoning: false };
  }
  return {
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    input: model.input ?? ['text'],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost_input: model.cost?.input,
    cost_output: model.cost?.output,
    cost_cacheRead: model.cost?.cacheRead,
    cost_cacheWrite: model.cost?.cacheWrite,
    compat_supportsDeveloperRole: model.compat?.supportsDeveloperRole,
    compat_supportsReasoningEffort: model.compat?.supportsReasoningEffort,
    compat_supportsUsageInStreaming: model.compat?.supportsUsageInStreaming,
    compat_maxTokensField: model.compat?.maxTokensField,
    compat_thinkingFormat: model.compat?.thinkingFormat,
  };
}

function fromFormValues(values: FormValues): PiModelDraft {
  const cost =
    values.cost_input !== undefined ||
    values.cost_output !== undefined ||
    values.cost_cacheRead !== undefined ||
    values.cost_cacheWrite !== undefined
      ? {
          input: values.cost_input ?? 0,
          output: values.cost_output ?? 0,
          cacheRead: values.cost_cacheRead ?? 0,
          cacheWrite: values.cost_cacheWrite ?? 0,
        }
      : undefined;

  const compat = {
    supportsDeveloperRole: values.compat_supportsDeveloperRole,
    supportsReasoningEffort: values.compat_supportsReasoningEffort,
    supportsUsageInStreaming: values.compat_supportsUsageInStreaming,
    maxTokensField: values.compat_maxTokensField,
    thinkingFormat: values.compat_thinkingFormat,
  };
  const compatHasValue = Object.values(compat).some((value) => value !== undefined);

  return {
    id: values.id.trim(),
    name: values.name?.trim() || undefined,
    reasoning: values.reasoning,
    input: values.input?.length ? values.input : undefined,
    contextWindow: values.contextWindow,
    maxTokens: values.maxTokens,
    cost,
    compat: compatHasValue ? compat : undefined,
  };
}

export const PiModelFormModal: React.FC<PiModelFormModalProps> = ({
  open,
  initial,
  onCancel,
  onSubmit,
  existingIds,
}) => {
  const [form] = Form.useForm<FormValues>();

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue(toFormValues(initial));
    }
  }, [open, initial, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    onSubmit(fromFormValues(values));
  };

  return (
    <Modal
      title={initial ? `Edit model: ${initial.id}` : 'Add model'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText={initial ? 'Save' : 'Add'}
      width={640}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          label="Model id"
          name="id"
          help="Passed verbatim to the provider. For llama.cpp/Ollama this must match the server's model alias."
          rules={[
            { required: true, message: 'Model id is required' },
            {
              validator: (_rule, value) => {
                if (
                  typeof value === 'string' &&
                  initial?.id !== value &&
                  existingIds.includes(value.trim())
                ) {
                  return Promise.reject(new Error(`Model id "${value}" already exists`));
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <Input placeholder="e.g. qwen2.5-coder-7b, my-model" />
        </Form.Item>

        <Form.Item label="Display name" name="name">
          <Input placeholder="Optional human-readable label" />
        </Form.Item>

        <Space size="large" style={{ width: '100%' }} align="start">
          <Form.Item
            label="Context window"
            name="contextWindow"
            style={{ width: 220 }}
            help="Tokens, including input + output"
          >
            <InputNumber min={0} step={1000} style={{ width: '100%' }} placeholder="128000" />
          </Form.Item>
          <Form.Item
            label="Max output tokens"
            name="maxTokens"
            style={{ width: 220 }}
          >
            <InputNumber min={0} step={1000} style={{ width: '100%' }} placeholder="16384" />
          </Form.Item>
          <Form.Item label="Reasoning" name="reasoning" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>

        <Form.Item label="Supported input" name="input">
          <Select
            mode="multiple"
            options={[
              { value: 'text', label: 'Text' },
              { value: 'image', label: 'Image' },
            ]}
          />
        </Form.Item>

        <Typography.Title level={5} style={{ marginTop: 8 }}>
          Cost per million tokens
        </Typography.Title>
        <Space size="large" wrap>
          <Form.Item label="Input" name="cost_input" style={{ width: 150 }}>
            <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Output" name="cost_output" style={{ width: 150 }}>
            <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Cache read" name="cost_cacheRead" style={{ width: 150 }}>
            <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Cache write" name="cost_cacheWrite" style={{ width: 150 }}>
            <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
        </Space>

        <Typography.Title level={5}>Model-level compat overrides</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          Leave blank to inherit the provider's compat settings.
        </Typography.Paragraph>
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
            <Select
              allowClear
              options={[
                { value: 'max_tokens', label: 'max_tokens' },
                { value: 'max_completion_tokens', label: 'max_completion_tokens' },
              ]}
              placeholder="Inherit"
            />
          </Form.Item>
          <Form.Item label="Thinking format" name="compat_thinkingFormat" style={{ width: 220 }}>
            <Select
              allowClear
              options={[
                { value: 'openai', label: 'openai (reasoning_effort)' },
                { value: 'zai', label: 'zai' },
                { value: 'qwen', label: 'qwen (enable_thinking)' },
                { value: 'qwen-chat-template', label: 'qwen-chat-template' },
              ]}
              placeholder="Inherit"
            />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
};
