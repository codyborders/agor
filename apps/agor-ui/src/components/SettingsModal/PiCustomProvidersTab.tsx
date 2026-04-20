/**
 * Pi Custom Providers Tab
 *
 * Manages user-defined providers in `~/.pi/agent/models.json`. Reads the
 * existing file through the pi-files service, lets the user add/edit/remove
 * providers via PiProviderFormModal, and writes the merged JSON back.
 *
 * Built-in Pi providers (anthropic, openai, google, minimax, zai, ...) are
 * not shown here — they live in pi-ai's generated model list. For those,
 * users only need an API key (Pi API Keys tab).
 */

import type { AgorClient } from '@agor/core/api';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Dropdown,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PiProviderFormModal } from './PiProviderFormModal';
import {
  PI_PROVIDER_PRESETS,
  type PiProviderDraft,
  type PiProviderPreset,
} from './piProviderPresets';

interface PiCustomProvidersTabProps {
  client: AgorClient | null;
}

interface ModelsDocument {
  providers?: Record<string, PiProviderDraft>;
  [key: string]: unknown;
}

export const PiCustomProvidersTab: React.FC<PiCustomProvidersTabProps> = ({ client }) => {
  const [doc, setDoc] = useState<ModelsDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | undefined>();
  const [editing, setEditing] = useState<{ mode: 'add' | 'edit'; draft?: PiProviderDraft } | null>(
    null
  );

  const fetchDocument = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const result = (await client.service('pi-files').get('models')) as {
        data?: ModelsDocument;
        raw?: string;
        parsed: boolean;
        parse_error?: string;
        file_path: string;
      };
      setFilePath(result.file_path);
      setParseError(result.parse_error);
      setDoc(result.parsed ? result.data ?? {} : {});
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to load models.json');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchDocument();
  }, [fetchDocument]);

  const providers = useMemo<Array<{ id: string; draft: PiProviderDraft }>>(() => {
    const entries = doc?.providers ?? {};
    return Object.entries(entries).map(([id, draft]) => ({
      id,
      draft: { ...draft, id },
    }));
  }, [doc]);

  const saveDocument = async (nextDoc: ModelsDocument) => {
    if (!client) return;
    setSaving(true);
    try {
      await client.service('pi-files').patch('models', {
        mode: 'structured',
        data: nextDoc,
      });
      setDoc(nextDoc);
      message.success('Saved ~/.pi/agent/models.json');
    } catch (err) {
      message.error((err as Error)?.message ?? 'Failed to save models.json');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (draft: PiProviderDraft) => {
    const nextProviders = { ...(doc?.providers ?? {}) };
    // Strip the id from the stored entry — it's already the key.
    const { id, ...storedDraft } = draft;
    nextProviders[id] = storedDraft;
    try {
      await saveDocument({ ...(doc ?? {}), providers: nextProviders });
      setEditing(null);
    } catch {
      // message shown in saveDocument
    }
  };

  const handleRemove = async (providerId: string) => {
    const nextProviders = { ...(doc?.providers ?? {}) };
    delete nextProviders[providerId];
    try {
      await saveDocument({ ...(doc ?? {}), providers: nextProviders });
    } catch {
      // message shown in saveDocument
    }
  };

  const handleAddPreset = (preset: PiProviderPreset) => {
    const existingIds = new Set(providers.map((provider) => provider.id));
    let candidate = preset.draft.id || preset.key;
    let suffix = 2;
    while (candidate && existingIds.has(candidate)) {
      candidate = `${preset.draft.id || preset.key}-${suffix}`;
      suffix += 1;
    }
    setEditing({
      mode: 'add',
      draft: { ...preset.draft, id: candidate },
    });
  };

  const presetMenuItems = PI_PROVIDER_PRESETS.map((preset) => ({
    key: preset.key,
    label: (
      <Space orientation="vertical" size={0} style={{ padding: '4px 0' }}>
        <Typography.Text strong>{preset.title}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'normal' }}>
          {preset.description}
        </Typography.Text>
      </Space>
    ),
    onClick: () => handleAddPreset(preset),
  }));

  const columns = [
    {
      title: 'Provider',
      dataIndex: 'id',
      key: 'id',
      render: (providerId: string, row: { draft: PiProviderDraft }) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{providerId}</Typography.Text>
          {row.draft.api && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {row.draft.api}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Base URL',
      dataIndex: ['draft', 'baseUrl'],
      key: 'baseUrl',
      render: (value?: string) =>
        value ? (
          <Typography.Text code style={{ fontSize: 12 }}>
            {value}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Models',
      key: 'models',
      width: 100,
      render: (_: unknown, row: { draft: PiProviderDraft }) => (
        <Tag>{row.draft.models?.length ?? 0}</Tag>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 120,
      render: (_: unknown, row: { id: string; draft: PiProviderDraft }) => (
        <Space>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => setEditing({ mode: 'edit', draft: row.draft })}
          />
          <Popconfirm
            title={`Remove provider "${row.id}"?`}
            description="Pi sessions using this provider will stop working until another provider supplies the model."
            okText="Remove"
            okType="danger"
            onConfirm={() => handleRemove(row.id)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const reservedIds = providers.map((provider) => provider.id);

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        Define providers beyond Pi's built-in list — local servers (llama.cpp, Ollama, LM Studio,
        vLLM), corporate proxies, or any OpenAI-compatible endpoint. Saved to{' '}
        {filePath ? <code>{filePath}</code> : <code>~/.pi/agent/models.json</code>}.
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
      {parseError && (
        <Alert
          type="warning"
          showIcon
          message="models.json could not be parsed as JSON"
          description={`Fix or remove the file to edit providers here. Error: ${parseError}`}
          style={{ marginBottom: 12 }}
        />
      )}

      <Space style={{ marginBottom: 12 }}>
        <Dropdown menu={{ items: presetMenuItems }} trigger={['click']} placement="bottomLeft">
          <Button type="primary" icon={<PlusOutlined />}>
            Add from preset
          </Button>
        </Dropdown>
        <Button
          icon={<PlusOutlined />}
          onClick={() => setEditing({ mode: 'add', draft: { id: '', api: 'openai-completions' } })}
        >
          Blank provider
        </Button>
        <Button icon={<ReloadOutlined />} onClick={fetchDocument} loading={loading}>
          Refresh
        </Button>
      </Space>

      <Table
        dataSource={providers}
        columns={columns}
        rowKey="id"
        loading={loading || saving}
        pagination={false}
        size="small"
        locale={{ emptyText: 'No custom providers yet' }}
      />

      {editing && (
        <PiProviderFormModal
          open
          initial={editing.draft}
          reservedIds={reservedIds}
          onCancel={() => setEditing(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
};
