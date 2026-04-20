/**
 * Pi API Keys Tab
 *
 * Lists every provider the Pi model registry knows about (built-in plus any
 * custom providers defined in ~/.pi/agent/models.json) and lets the user paste
 * or clear an API key per provider. Writes go through the pi-auth service,
 * which persists to ~/.pi/agent/auth.json via Pi's AuthStorage.
 */

import type { AgorClient } from '@agor/core/api';
import type { PiAuthProviderStatus } from '@agor/core/types';
import {
  CheckCircleFilled,
  DeleteOutlined,
  KeyOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface PiApiKeysTabProps {
  client: AgorClient | null;
}

interface ProviderRow extends PiAuthProviderStatus {
  is_custom: boolean;
  help_url?: string;
}

// Providers baked into pi-ai's models.generated.js. Anything outside this
// set is a custom provider defined in ~/.pi/agent/models.json.
const BUILT_IN_PROVIDER_IDS = new Set([
  'anthropic',
  'openai',
  'google',
  'google-vertex',
  'azure',
  'bedrock',
  'mistral',
  'groq',
  'cerebras',
  'deepseek',
  'xai',
  'openrouter',
  'vercel',
  'together',
  'fireworks',
  'replicate',
  'minimax',
  'minimax-cn',
  'zai',
  'baseten',
  'novita',
  'qwen',
]);

// Where to get an API key for each known provider. Shown as a help link
// next to the provider id; users can still configure unknown providers.
const HELP_URLS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/app/apikey',
  minimax: 'https://www.minimax.io/platform/user-center/basic-information/interface-key',
  'minimax-cn': 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  zai: 'https://z.ai/manage-apikey/apikey-list',
  mistral: 'https://console.mistral.ai/api-keys',
  groq: 'https://console.groq.com/keys',
  cerebras: 'https://cloud.cerebras.ai',
  deepseek: 'https://platform.deepseek.com/api_keys',
  xai: 'https://console.x.ai',
  openrouter: 'https://openrouter.ai/keys',
  together: 'https://api.together.xyz/settings/api-keys',
  fireworks: 'https://fireworks.ai/account/api-keys',
};

// The auth service title-cases provider ids but the well-known brands have
// their own capitalization conventions.
const PROVIDER_LABEL_OVERRIDES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  zai: 'Z.ai',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax (China)',
  xai: 'xAI',
  openrouter: 'OpenRouter',
};

function formatProviderLabel(providerId: string, name: string): string {
  return PROVIDER_LABEL_OVERRIDES[providerId] ?? name;
}

export const PiApiKeysTab: React.FC<PiApiKeysTabProps> = ({ client }) => {
  const [providers, setProviders] = useState<PiAuthProviderStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProviderRow | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearingId, setClearingId] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const result = await client.service('pi-auth').find({});
      const list = Array.isArray(result)
        ? (result as PiAuthProviderStatus[])
        : // biome-ignore lint/suspicious/noExplicitAny: FeathersJS service envelope shape varies
          ((result as any).data ?? []);
      setProviders(list);
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to load Pi providers');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const rows = useMemo<ProviderRow[]>(
    () =>
      providers.map((provider) => ({
        ...provider,
        is_custom: !BUILT_IN_PROVIDER_IDS.has(provider.provider_id),
        help_url: HELP_URLS[provider.provider_id],
      })),
    [providers]
  );

  const builtInRows = useMemo(() => rows.filter((row) => !row.is_custom), [rows]);
  const customRows = useMemo(() => rows.filter((row) => row.is_custom), [rows]);

  const handleSave = async () => {
    if (!client || !editing || !keyInput.trim()) return;
    setSaving(true);
    try {
      await client.service('pi-auth').patch(editing.provider_id, {
        action: 'set_api_key',
        api_key: keyInput.trim(),
      });
      message.success(`Saved API key for ${formatProviderLabel(editing.provider_id, editing.name)}`);
      setEditing(null);
      setKeyInput('');
      await fetchProviders();
    } catch (err) {
      message.error((err as Error)?.message ?? 'Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async (row: ProviderRow) => {
    if (!client) return;
    setClearingId(row.provider_id);
    try {
      await client.service('pi-auth').remove(row.provider_id, {
        query: { action: 'logout' },
      });
      message.success(`Cleared API key for ${formatProviderLabel(row.provider_id, row.name)}`);
      await fetchProviders();
    } catch (err) {
      message.error((err as Error)?.message ?? 'Failed to clear API key');
    } finally {
      setClearingId(null);
    }
  };

  const columns = [
    {
      title: 'Provider',
      dataIndex: 'provider_id',
      key: 'provider_id',
      render: (providerId: string, row: ProviderRow) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{formatProviderLabel(providerId, row.name)}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <code>{providerId}</code>
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Auth',
      dataIndex: 'auth_type',
      key: 'auth_type',
      width: 110,
      render: (authType: PiAuthProviderStatus['auth_type']) => (
        <Tag color={authType === 'oauth' ? 'purple' : authType === 'subscription' ? 'gold' : 'blue'}>
          {authType === 'api_key' ? 'API key' : authType}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'configured',
      key: 'configured',
      width: 140,
      render: (configured: boolean, row: ProviderRow) =>
        configured ? (
          <Space size={4}>
            <CheckCircleFilled style={{ color: '#52c41a' }} />
            <Typography.Text>Configured</Typography.Text>
          </Space>
        ) : (
          <Typography.Text type="secondary">
            {row.auth_type === 'oauth' ? 'Not logged in' : 'No key set'}
          </Typography.Text>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 220,
      render: (_: unknown, row: ProviderRow) => {
        const oauthOnly = row.auth_type === 'oauth' && !row.configured;
        return (
          <Space>
            <Tooltip
              title={
                oauthOnly
                  ? 'This provider uses OAuth login only; set up via pi CLI.'
                  : undefined
              }
            >
              <Button
                size="small"
                icon={<KeyOutlined />}
                onClick={() => {
                  setEditing(row);
                  setKeyInput('');
                }}
                disabled={oauthOnly}
              >
                {row.configured ? 'Replace key' : 'Set key'}
              </Button>
            </Tooltip>
            {row.configured && (
              <Popconfirm
                title="Clear this API key?"
                description="Pi sessions using this provider will stop working until a new key is set."
                okText="Clear"
                okType="danger"
                onConfirm={() => handleClear(row)}
              >
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  loading={clearingId === row.provider_id}
                />
              </Popconfirm>
            )}
            {row.help_url && (
              <Typography.Link href={row.help_url} target="_blank" rel="noopener noreferrer">
                Get key
              </Typography.Link>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        API keys for the Pi coding agent's model providers. Keys are stored locally in{' '}
        <code>~/.pi/agent/auth.json</code> and used when Pi sessions call the provider. Built-in
        providers (MiniMax, Z.ai, Anthropic, OpenAI, Google, etc.) only need a key here — their
        endpoints and model lists are baked into Pi. Custom providers come from the{' '}
        <b>Pi Custom Providers</b> tab.
      </Typography.Paragraph>

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 12 }}
          closable
          onClose={() => setError(null)}
        />
      )}

      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={fetchProviders} loading={loading}>
          Refresh
        </Button>
      </Space>

      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Built-in providers
      </Typography.Title>
      <Table
        dataSource={builtInRows}
        columns={columns}
        rowKey="provider_id"
        loading={loading && builtInRows.length === 0}
        pagination={false}
        size="small"
        locale={{ emptyText: 'No built-in Pi providers detected' }}
        style={{ marginBottom: 24 }}
      />

      <Typography.Title level={5}>Custom providers</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        Defined in <code>~/.pi/agent/models.json</code> via the <b>Pi Custom Providers</b> tab.
      </Typography.Paragraph>
      <Table
        dataSource={customRows}
        columns={columns}
        rowKey="provider_id"
        pagination={false}
        size="small"
        locale={{
          emptyText: 'No custom providers yet. Add one under Pi Custom Providers.',
        }}
      />

      <Modal
        title={
          editing ? (
            <Space>
              <KeyOutlined />
              {`${editing.configured ? 'Replace' : 'Set'} API key · ${formatProviderLabel(
                editing.provider_id,
                editing.name
              )}`}
            </Space>
          ) : null
        }
        open={!!editing}
        onOk={handleSave}
        okText="Save"
        okButtonProps={{ disabled: !keyInput.trim(), loading: saving }}
        onCancel={() => {
          setEditing(null);
          setKeyInput('');
        }}
      >
        <Typography.Paragraph type="secondary">
          The key is written to <code>~/.pi/agent/auth.json</code> on the daemon host. It is not
          sent to Agor's server or shared across users.
        </Typography.Paragraph>
        <Input.Password
          placeholder="Paste API key"
          value={keyInput}
          onChange={(event) => setKeyInput(event.target.value)}
          onPressEnter={handleSave}
          autoFocus
        />
        {editing?.help_url && (
          <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
            <Typography.Link href={editing.help_url} target="_blank" rel="noopener noreferrer">
              Get an API key from {formatProviderLabel(editing.provider_id, editing.name)}
            </Typography.Link>
          </Typography.Paragraph>
        )}
      </Modal>
    </div>
  );
};
