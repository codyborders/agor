import type { MCPServer, PiMcpToolCallResult } from '@agor/core/types';
import { describe, expect, it, vi } from 'vitest';
import { buildPiMcpTools } from './pi-mcp-tools.js';

function createServer(overrides: Partial<MCPServer> = {}): MCPServer {
  return {
    mcp_server_id: '550e8400-e29b-41d4-a716-446655440999',
    name: 'filesystem',
    display_name: 'Filesystem',
    description: 'Filesystem MCP',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    scope: 'global',
    source: 'user',
    enabled: true,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    tools: [
      {
        name: 'read_file',
        description: 'Read a file',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      },
    ],
    ...overrides,
  } as MCPServer;
}

describe('buildPiMcpTools', () => {
  it('creates Pi custom tools for discovered MCP tools', async () => {
    const create = vi.fn<() => Promise<PiMcpToolCallResult>>().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      is_error: false,
      server_id: '550e8400-e29b-41d4-a716-446655440999',
      server_name: 'Filesystem',
      tool_name: 'read_file',
      details: {
        raw_result: { content: [{ type: 'text', text: 'ok' }] },
      },
    });
    const client = {
      service: vi.fn().mockReturnValue({ create }),
    } as unknown as {
      service(path: string): { create: typeof create };
    };

    const tools = buildPiMcpTools({
      client: client as never,
      sessionId: '550e8400-e29b-41d4-a716-446655440001' as never,
      servers: [createServer()],
      builtInToolNames: new Set(['read', 'write']),
    });

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('mcp__filesystem__read_file');

    const result = await tools[0].execute('call-1', { path: 'README.md' }, undefined, undefined);

    expect(create).toHaveBeenCalledWith({
      session_id: '550e8400-e29b-41d4-a716-446655440001',
      mcp_server_id: '550e8400-e29b-41d4-a716-446655440999',
      tool_name: 'read_file',
      arguments: { path: 'README.md' },
    });
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(result.details).toMatchObject({
      isError: false,
      serverName: 'Filesystem',
      toolName: 'read_file',
    });
  });

  it('adds a suffix when an MCP tool name collides with an existing tool', () => {
    const client = {
      service: vi.fn().mockReturnValue({
        create: vi.fn(),
      }),
    } as unknown as {
      service(path: string): { create: () => Promise<PiMcpToolCallResult> };
    };

    const tools = buildPiMcpTools({
      client: client as never,
      sessionId: '550e8400-e29b-41d4-a716-446655440001' as never,
      servers: [createServer()],
      builtInToolNames: new Set(['mcp__filesystem__read_file']),
    });

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('mcp__filesystem__read_file__550e8400');
  });

  it('returns an error-shaped tool result when proxy execution fails', async () => {
    const client = {
      service: vi.fn().mockReturnValue({
        create: vi.fn().mockRejectedValue(new Error('proxy down')),
      }),
    } as unknown as {
      service(path: string): { create: () => Promise<PiMcpToolCallResult> };
    };

    const tools = buildPiMcpTools({
      client: client as never,
      sessionId: '550e8400-e29b-41d4-a716-446655440001' as never,
      servers: [createServer()],
      builtInToolNames: new Set(),
    });

    const result = await tools[0].execute('call-1', { path: 'README.md' }, undefined, undefined);

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'MCP tool read_file failed: proxy down',
    });
    expect(result.details).toMatchObject({
      isError: true,
      error: 'proxy down',
    });
  });
});
