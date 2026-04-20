/**
 * Pi Provider Form Modal
 *
 * Add or edit a custom provider for `~/.pi/agent/models.json`. Users can start
 * from a preset (llama.cpp, Ollama, LM Studio, vLLM, blank proxy) or fill the
 * form directly. Supports nested model management via PiModelFormModal.
 */

import { DeleteOutlined, EditOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Checkbox,
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
import { useEffect, useMemo, useState } from 'react';
import {
  compatFromFormValues,
  compatToFormValues,
  PiCompatFlagsFields,
  type PiCompatFormValues,
} from './PiCompatFlagsFields';
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

interface FormValues extends PiCompatFormValues {
  id: string;
  baseUrl?: string;
  api?: PiProviderApi;
  apiKey?: string;
  authHeader?: boolean;
  headers?: HeaderRow[];
  /** User acknowledgement that apiKey / a header value will be executed as a shell command. */
  shellCommandAck?: boolean;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
// RFC 7230 token grammar for HTTP header field names.
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

function describeBaseUrl(raw: string | undefined): {
  valid: boolean;
  insecure: boolean;
  reason?: string;
} {
  if (!raw || !raw.trim()) {
    return { valid: false, insecure: false, reason: 'Base URL is required' };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { valid: false, insecure: false, reason: 'Enter a valid URL (e.g. https://host/v1)' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      insecure: false,
      reason: `Only http:// and https:// are supported (got ${parsed.protocol})`,
    };
  }
  const insecure =
    parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  return { valid: true, insecure };
}

function isShellCommand(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().startsWith('!');
}

function toFormValues(draft: PiProviderDraft | undefined): FormValues {
  if (!draft) {
    return { id: '', api: 'openai-completions', shellCommandAck: false };
  }
  const headers = draft.headers
    ? Object.entries(draft.headers).map(([key, value]) => ({ key, value }))
    : [];
  return {
    id: draft.id,
    baseUrl: draft.baseUrl,
    api: draft.api ?? 'openai-completions',
    // apiKey is intentionally never re-populated when editing: the daemon
    // should mask it server-side, and we don't want the cleartext key to
    // appear in the React tree, in DevTools, or in a screenshot. Users must
    // re-enter the key to change it.
    apiKey: undefined,
    authHeader: draft.authHeader,
    headers,
    shellCommandAck: false,
    ...compatToFormValues(draft.compat),
  };
}

function fromFormValues(values: FormValues, models: PiModelDraft[]): PiProviderDraft {
  const headers: Record<string, string> = {};
  for (const row of values.headers ?? []) {
    const name = row?.key?.trim();
    if (name) {
      // Strip any stray CR/LF to prevent header injection downstream.
      headers[name] = (row.value ?? '').replace(/[\r\n]+/g, ' ');
    }
  }

  return {
    id: values.id.trim(),
    baseUrl: values.baseUrl?.trim() || undefined,
    api: values.api,
    apiKey: values.apiKey?.trim() || undefined,
    authHeader: values.authHeader || undefined,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    compat: compatFromFormValues(values),
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

  // Watch fields that drive cross-field warnings so the UI updates live.
  const baseUrlValue = Form.useWatch('baseUrl', form);
  const apiKeyValue = Form.useWatch('apiKey', form);
  const authHeaderValue = Form.useWatch('authHeader', form);
  const headersValue = Form.useWatch('headers', form) as HeaderRow[] | undefined;
  const shellCommandAckValue = Form.useWatch('shellCommandAck', form);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue(toFormValues(initial));
      setModels(initial?.models ?? []);
    }
  }, [open, initial, form]);

  const handleAddModel = () => setEditingModel({ index: -1 });
  const handleEditModel = (index: number) => setEditingModel({ index, model: models[index] });
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

  const reservedExceptSelf = useMemo(
    () => reservedIds.filter((id) => id !== initial?.id),
    [reservedIds, initial?.id]
  );

  const baseUrlInfo = describeBaseUrl(baseUrlValue);
  const hasShellKey = isShellCommand(apiKeyValue);
  const hasShellHeader = (headersValue ?? []).some((row) => isShellCommand(row?.value));
  const requiresShellAck = hasShellKey || hasShellHeader;
  const bearerOverHttp = authHeaderValue && baseUrlInfo.insecure;

  const modelIds = useMemo(() => models.map((model) => model.id), [models]);

  return (
    <>
      <Modal
        title={isEditing ? `Edit provider: ${initial?.id}` : 'Add custom provider'}
        open={open}
        onOk={handleOk}
        onCancel={onCancel}
        okText={isEditing ? 'Save' : 'Add provider'}
        okButtonProps={{
          disabled: requiresShellAck && !shellCommandAckValue,
        }}
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
                      return Promise.reject(new Error(`Provider id "${value}" already exists`));
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
            rules={[
              { required: true, message: 'Base URL is required' },
              {
                validator: (_rule, value) => {
                  const result = describeBaseUrl(typeof value === 'string' ? value : undefined);
                  return result.valid
                    ? Promise.resolve()
                    : Promise.reject(new Error(result.reason));
                },
              },
            ]}
          >
            <Input placeholder="https://api.example.com/v1 or http://localhost:8080/v1" />
          </Form.Item>
          {baseUrlInfo.insecure && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Base URL uses plain HTTP to a non-loopback host"
              description="Traffic (including any API key sent as a bearer) will be unencrypted. Prefer https:// unless this is a local network host you explicitly trust."
            />
          )}

          <Form.Item
            label="API key"
            name="apiKey"
            help={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Literal value, env var name (e.g. <code>MY_API_KEY</code>), or shell command
                prefixed with <code>!</code>. Local servers like llama.cpp usually accept any
                placeholder. {isEditing && 'Leave blank to keep the currently stored key.'}
              </Typography.Text>
            }
          >
            <Input.Password
              placeholder={
                isEditing
                  ? 'Leave blank to keep current key'
                  : "sk-... or MY_API_KEY or !op read 'op://vault/item/credential'"
              }
              autoComplete="new-password"
              visibilityToggle
            />
          </Form.Item>

          <Form.Item label="Auth header" name="authHeader" valuePropName="checked">
            <Switch checkedChildren="Authorization: Bearer" unCheckedChildren="Off" />
          </Form.Item>
          {bearerOverHttp && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Bearer token over cleartext HTTP"
              description="You're about to send Authorization headers over http:// to a non-loopback host. Anyone on the network path can read the key."
            />
          )}

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
                      rules={[
                        {
                          validator: (_rule, value) => {
                            if (!value || !String(value).trim()) return Promise.resolve();
                            return HEADER_NAME_PATTERN.test(String(value).trim())
                              ? Promise.resolve()
                              : Promise.reject(
                                  new Error(
                                    "Header name must match the HTTP token grammar (letters, digits, !#$%&'*+-.^_`|~)"
                                  )
                                );
                          },
                        },
                      ]}
                    >
                      <Input placeholder="Header-Name" />
                    </Form.Item>
                    <Form.Item
                      {...rest}
                      name={[name, 'value']}
                      style={{ width: 360, marginBottom: 0 }}
                      rules={[
                        {
                          validator: (_rule, value) => {
                            if (typeof value === 'string' && /[\r\n]/.test(value)) {
                              return Promise.reject(
                                new Error('Header value cannot contain newlines')
                              );
                            }
                            return Promise.resolve();
                          },
                        },
                      ]}
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

          {requiresShellAck && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12, marginBottom: 12 }}
              message="This provider will execute a shell command"
              description={
                <>
                  <Typography.Paragraph style={{ marginBottom: 8 }}>
                    Values prefixed with <code>!</code> are run as shell commands on the daemon host
                    each time Pi resolves the provider. Only save this if you authored the command
                    and understand what it does — a wrong value can run arbitrary code under the
                    daemon's OS identity.
                  </Typography.Paragraph>
                  <Form.Item
                    name="shellCommandAck"
                    valuePropName="checked"
                    style={{ marginBottom: 0 }}
                  >
                    <Checkbox>
                      I understand this will execute shell commands on the daemon host.
                    </Checkbox>
                  </Form.Item>
                </>
              }
            />
          )}

          <Divider orientation="left" plain>
            Compat flags
          </Divider>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            Set these for OpenAI-compatible servers that differ from OpenAI's reference behavior.
            Local llama.cpp/Ollama/LM Studio/vLLM typically need developer role off, reasoning
            effort off, and usage-in-streaming off.
          </Typography.Paragraph>
          <PiCompatFlagsFields />

          <Divider orientation="left" plain>
            Models
          </Divider>
          <Table
            dataSource={models.map((model, index) => ({ ...model, __index: index }))}
            rowKey="__index"
            size="small"
            pagination={false}
            locale={{
              emptyText:
                'No models yet. Add at least one so Pi knows what to call on this provider.',
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
        existingIds={modelIds}
        onCancel={() => setEditingModel(null)}
        onSubmit={handleModelSubmit}
      />
    </>
  );
};
