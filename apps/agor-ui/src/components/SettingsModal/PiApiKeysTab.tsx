/**
 * Pi API Keys Tab
 *
 * Lists every provider the Pi model registry knows about (built-in plus any
 * custom providers defined in ~/.pi/agent/models.json) and lets the user paste
 * or clear an API key per provider. Writes go through the pi-auth service,
 * which persists to ~/.pi/agent/auth.json via Pi's AuthStorage.
 *
 * Built-in vs custom grouping, help URLs, and curated display labels all come
 * from the daemon (enriched PiAuthProviderStatus). The UI has no hard-coded
 * knowledge of pi-ai's catalog.
 */

import type { AgorClient } from '@agor/core/api';
import type { PiAuthProviderStatus } from '@agor/core/types';
import { CheckCircleFilled, DeleteOutlined, KeyOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Modal, message, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface PiApiKeysTabProps {
  client: AgorClient | null;
}

const AUTH_TAG_COLORS: Record<PiAuthProviderStatus['auth_type'], string> = {
  api_key: 'blue',
  oauth: 'purple',
  subscription: 'gold',
};

function formatProviderLabel(row: PiAuthProviderStatus): string {
  return row.display_label ?? row.name;
}

function unwrapServiceList<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'data' in (result as Record<string, unknown>)) {
    const data = (result as { data?: unknown }).data;
    if (Array.isArray(data)) return data as T[];
  }
  return [];
}

export const PiApiKeysTab: React.FC<PiApiKeysTabProps> = ({ client }) => {
  const [providers, setProviders] = useState<PiAuthProviderStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PiAuthProviderStatus | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<PiAuthProviderStatus | null>(null);
  const [clearConfirmInput, setClearConfirmInput] = useState('');

  const fetchProviders = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const result = await client.service('pi-auth').find({});
      setProviders(unwrapServiceList<PiAuthProviderStatus>(result));
    } catch (err) {
      // Generic user-facing message; detailed error ends up in the console
      // only, not in a toast that could leak paths/keys.
      console.error('[pi-api-keys] Failed to load providers:', err);
      setError('Failed to load Pi providers — check daemon logs for details.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const builtInRows = useMemo(
    () => providers.filter((provider) => provider.is_built_in !== false),
    [providers]
  );
  const customRows = useMemo(
    () => providers.filter((provider) => provider.is_built_in === false),
    [providers]
  );

  const handleSave = async () => {
    if (!client || !editing || !keyInput.trim()) return;
    setSaving(true);
    try {
      await client.service('pi-auth').patch(editing.provider_id, {
        action: 'set_api_key',
        api_key: keyInput.trim(),
      });
      message.success(`Saved API key for ${formatProviderLabel(editing)}`);
      setEditing(null);
      setKeyInput('');
      await fetchProviders();
    } catch (err) {
      console.error('[pi-api-keys] Failed to save API key:', err);
      message.error('Failed to save API key — check daemon logs for details.');
    } finally {
      setSaving(false);
    }
  };

  const handleClearConfirm = async () => {
    if (!client || !clearTarget) return;
    if (clearConfirmInput.trim() !== clearTarget.provider_id) return;
    setClearingId(clearTarget.provider_id);
    try {
      await client.service('pi-auth').remove(clearTarget.provider_id, {
        query: { action: 'logout' },
      });
      message.success(`Cleared API key for ${formatProviderLabel(clearTarget)}`);
      setClearTarget(null);
      setClearConfirmInput('');
      await fetchProviders();
    } catch (err) {
      console.error('[pi-api-keys] Failed to clear API key:', err);
      message.error('Failed to clear API key — check daemon logs for details.');
    } finally {
      setClearingId(null);
    }
  };

  const columns = useMemo(
    () => [
      {
        title: 'Provider',
        dataIndex: 'provider_id',
        key: 'provider_id',
        render: (providerId: string, row: PiAuthProviderStatus) => (
          <Space orientation="vertical" size={0}>
            <Typography.Text strong>{formatProviderLabel(row)}</Typography.Text>
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
          <Tag color={AUTH_TAG_COLORS[authType]}>
            {authType === 'api_key' ? 'API key' : authType}
          </Tag>
        ),
      },
      {
        title: 'Status',
        dataIndex: 'configured',
        key: 'configured',
        width: 140,
        render: (configured: boolean, row: PiAuthProviderStatus) =>
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
        render: (_: unknown, row: PiAuthProviderStatus) => {
          const oauthOnly = row.auth_type === 'oauth' && !row.configured;
          return (
            <Space>
              <Tooltip
                title={
                  oauthOnly ? 'This provider uses OAuth login only; set up via pi CLI.' : undefined
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
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  loading={clearingId === row.provider_id}
                  onClick={() => {
                    setClearTarget(row);
                    setClearConfirmInput('');
                  }}
                />
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
    ],
    [clearingId]
  );

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
                editing
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
              Get an API key from {formatProviderLabel(editing)}
            </Typography.Link>
          </Typography.Paragraph>
        )}
      </Modal>

      <Modal
        title={
          clearTarget ? (
            <Space>
              <DeleteOutlined />
              {`Clear API key · ${formatProviderLabel(clearTarget)}`}
            </Space>
          ) : null
        }
        open={!!clearTarget}
        onOk={handleClearConfirm}
        okText="Clear key"
        okButtonProps={{
          danger: true,
          disabled:
            !clearTarget ||
            clearConfirmInput.trim() !== clearTarget.provider_id ||
            clearingId === clearTarget.provider_id,
          loading: clearingId === clearTarget?.provider_id,
        }}
        onCancel={() => {
          setClearTarget(null);
          setClearConfirmInput('');
        }}
      >
        <Typography.Paragraph>
          Pi sessions using this provider will stop working until a new key is set. To confirm, type
          the provider id <code>{clearTarget?.provider_id}</code> below.
        </Typography.Paragraph>
        <Input
          placeholder={clearTarget?.provider_id ?? ''}
          value={clearConfirmInput}
          onChange={(event) => setClearConfirmInput(event.target.value)}
          onPressEnter={handleClearConfirm}
          autoFocus
        />
      </Modal>
    </div>
  );
};
