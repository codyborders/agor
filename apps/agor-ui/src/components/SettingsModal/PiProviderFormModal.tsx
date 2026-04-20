/**
 * Pi Provider Form Modal
 *
 * Add or edit a custom provider for `~/.pi/agent/models.json`. Users can start
 * from a preset (llama.cpp, Ollama, LM Studio, vLLM, blank proxy) or fill the
 * form directly. Supports nested model management via PiModelFormModal.
 */

import {
  DeleteOutlined,
  EditOutlined,
  MinusCircleOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  Button,
  Divider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { PiModelFormModal } from './PiModelFormModal';
import type { PiModelDraft, PiProviderApi, PiProviderDraft } from './piProviderPresets';

interface PiProviderFormModalProps {
  open: boolean;
  initial?: PiProviderDraft;
  reservedIds?: string[];
  onCancel: () => void;
  onSubmit: (provider: PiProviderDraft) => void;
}

interface HeaderRow {
  key: string;
  value: string;
}

interface FormValues {
  id: string;
  baseUrl?: string;
  api?: PiProviderApi;
  apiKey?: string;
  authHeader?: boolean;
  headers?: HeaderRow[];
  compat_supportsDeveloperRole?: boolean;
  compat_supportsReasoningEffort?: boolean;
  compat_supportsUsageInStreaming?: boolean;
  compat_maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  compat_thinkingFormat?: 'openai' | 'zai' | 'qwen' | 'qwen-chat-template';
}

function toFormValues(draft: PiProviderDraft | undefined): FormValues {
  if (!draft) {
    return { api: 'openai-completions' };
  }
  const headers = draft.headers
    ? Object.entries(draft.headers).map(([key, value]) => ({ key, value }))
    : [];
  return {
    id: draft.id,
    baseUrl: draft.baseUrl,
    api: draft.api ?? 'openai-completions',
    apiKey: draft.apiKey,
    authHeader: draft.authHeader,
    headers,
    compat_supportsDeveloperRole: draft.compat?.supportsDeveloperRole,
    compat_supportsReasoningEffort: draft.compat?.supportsReasoningEffort,
    compat_supportsUsageInStreaming: draft.compat?.supportsUsageInStreaming,
    compat_maxTokensField: draft.compat?.maxTokensField,
    compat_thinkingFormat: draft.compat?.thinkingFormat,
  };
}

function fromFormValues(values: FormValues, models: PiModelDraft[]): PiProviderDraft {
  const headers: Record<string, string> = {};
  for (const row of values.headers ?? []) {
    if (row?.key?.trim()) {
      headers[row.key.trim()] = row.value ?? '';
    }
  }

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
    baseUrl: values.baseUrl?.trim() || undefined,
    api: values.api,
    apiKey: values.apiKey?.trim() || undefined,
    authHeader: values.authHeader || undefined,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    compat: compatHasValue ? compat : undefined,
    models,
  };
}

export const PiProviderFormModal: React.FC<PiProviderFormModalProps> = ({
  open,
  initial,
  reservedIds = [],
  onCancel,
  onSubmit,
}) => {
  const [form] = Form.useForm<FormValues>();
  const [models, setModels] = useState<PiModelDraft[]>([]);
  const [editingModel, setEditingModel] = useState<{ index: number; model?: PiModelDraft } | null>(
    null
  );
  const isEditing = Boolean(initial);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue(toFormValues(initial));
      setModels(initial?.models ?? []);
    }
  }, [open, initial, form]);

  const handleAddModel = () => setEditingModel({ index: -1 });
  const handleEditModel = (index: number) =>
    setEditingModel({ index, model: models[index] });
  const handleRemoveModel = (index: number) => {
    setModels((previous) => previous.filter((_, position) => position !== index));
  };

  const handleModelSubmit = (model: PiModelDraft) => {
    setModels((previous) => {
      if (!editingModel) return previous;
      if (editingModel.index < 0) {
        return [...previous, model];
      }
      const next = [...previous];
      next[editingModel.index] = model;
      return next;
    });
    setEditingModel(null);
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    onSubmit(fromFormValues(values, models));
  };

  const reservedExceptSelf = initial
    ? reservedIds.filter((id) => id !== initial.id)
    : reservedIds;

  return (
    <>
      <Modal
        title={isEditing ? `Edit provider: ${initial?.id}` : 'Add custom provider'}
        open={open}
        onOk={handleOk}
        onCancel={onCancel}
        okText={isEditing ? 'Save' : 'Add provider'}
        width={760}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Space size="large" style={{ width: '100%' }} align="start">
            <Form.Item
              label="Provider id"
              name="id"
              style={{ width: 260 }}
              help="Lowercase identifier used internally by Pi. Also the auth.json key."
              rules={[
                { required: true, message: 'Provider id is required' },
                {
                  pattern: /^[a-z0-9][a-z0-9_-]*$/,
                  message: 'Use lowercase letters, digits, hyphens, underscores',
                },
                {
                  validator: (_rule, value) => {
                    if (typeof value === 'string' && reservedExceptSelf.includes(value.trim())) {
                      return Promise.reject(
                        new Error(`Provider id "${value}" already exists`)
                      );
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <Input placeholder="e.g. llama-cpp, my-proxy" disabled={isEditing} />
            </Form.Item>
            <Form.Item label="API type" name="api" style={{ width: 260 }}>
              <Select
                options={[
                  { value: 'openai-completions', label: 'openai-completions' },
                  { value: 'openai-responses', label: 'openai-responses' },
                  { value: 'anthropic-messages', label: 'anthropic-messages' },
                  { value: 'google-generative-ai', label: 'google-generative-ai' },
                ]}
              />
            </Form.Item>
          </Space>

          <Form.Item
            label="Base URL"
            name="baseUrl"
            rules={[{ required: true, message: 'Base URL is required' }]}
          >
            <Input placeholder="https://api.example.com/v1 or http://localhost:8080/v1" />
          </Form.Item>

          <Form.Item
            label="API key"
            name="apiKey"
            help={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Literal value, env var name (e.g. <code>MY_API_KEY</code>), or shell command
                prefixed with <code>!</code>. Local servers like llama.cpp usually accept any
                placeholder.
              </Typography.Text>
            }
          >
            <Input placeholder="sk-... or MY_API_KEY or !op read 'op://vault/item/credential'" />
          </Form.Item>

          <Form.Item label="Auth header" name="authHeader" valuePropName="checked">
            <Switch checkedChildren="Authorization: Bearer" unCheckedChildren="Off" />
          </Form.Item>

          <Divider orientation="left" plain>
            Custom headers
          </Divider>
          <Form.List name="headers">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...rest }) => (
                  <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                    <Form.Item
                      {...rest}
                      name={[name, 'key']}
                      style={{ width: 240, marginBottom: 0 }}
                    >
                      <Input placeholder="Header-Name" />
                    </Form.Item>
                    <Form.Item
                      {...rest}
                      name={[name, 'value']}
                      style={{ width: 360, marginBottom: 0 }}
                    >
                      <Input placeholder="literal / env var / !shell" />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(name)} />
                  </Space>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ key: '', value: '' })}
                  block
                >
                  Add header
                </Button>
              </>
            )}
          </Form.List>

          <Divider orientation="left" plain>
            Compat flags
          </Divider>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            Set these for OpenAI-compatible servers that differ from OpenAI's reference behavior.
            Local llama.cpp/Ollama/LM Studio/vLLM typically need developer role off, reasoning
            effort off, and usage-in-streaming off.
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
            <Form.Item
              label="Max tokens field"
              name="compat_maxTokensField"
              style={{ width: 220 }}
            >
              <Select
                allowClear
                options={[
                  { value: 'max_tokens', label: 'max_tokens' },
                  { value: 'max_completion_tokens', label: 'max_completion_tokens' },
                ]}
                placeholder="Inherit"
              />
            </Form.Item>
            <Form.Item
              label="Thinking format"
              name="compat_thinkingFormat"
              style={{ width: 220 }}
            >
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

          <Divider orientation="left" plain>
            Models
          </Divider>
          <Table
            dataSource={models.map((model, index) => ({ ...model, __index: index }))}
            rowKey="__index"
            size="small"
            pagination={false}
            locale={{
              emptyText: 'No models yet. Add at least one so Pi knows what to call on this provider.',
            }}
            columns={[
              {
                title: 'Id',
                dataIndex: 'id',
                key: 'id',
                render: (id: string, row: PiModelDraft) => (
                  <Space orientation="vertical" size={0}>
                    <Typography.Text code>{id}</Typography.Text>
                    {row.name && row.name !== id && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {row.name}
                      </Typography.Text>
                    )}
                  </Space>
                ),
              },
              {
                title: 'Context',
                dataIndex: 'contextWindow',
                key: 'contextWindow',
                width: 120,
                render: (value?: number) =>
                  value ? (
                    <Typography.Text>{value.toLocaleString()}</Typography.Text>
                  ) : (
                    <Typography.Text type="secondary">—</Typography.Text>
                  ),
              },
              {
                title: 'Reasoning',
                dataIndex: 'reasoning',
                key: 'reasoning',
                width: 110,
                render: (value?: boolean) =>
                  value ? <Tag color="purple">yes</Tag> : <Tag>no</Tag>,
              },
              {
                title: '',
                key: 'actions',
                width: 80,
                render: (_: unknown, row: PiModelDraft & { __index: number }) => (
                  <Space>
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => handleEditModel(row.__index)}
                    />
                    <Popconfirm
                      title={`Remove ${row.id}?`}
                      okText="Remove"
                      okType="danger"
                      onConfirm={() => handleRemoveModel(row.__index)}
                    >
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={handleAddModel}
            style={{ marginTop: 8 }}
            block
          >
            Add model
          </Button>
        </Form>
      </Modal>

      <PiModelFormModal
        open={editingModel !== null}
        initial={editingModel?.model}
        existingIds={models.map((model) => model.id)}
        onCancel={() => setEditingModel(null)}
        onSubmit={handleModelSubmit}
      />
    </>
  );
};
