/**
 * Pi MCP Tools Service
 *
 * Executes scoped MCP tools on behalf of Pi custom tools.
 */

import { createUserProcessEnvironment } from '@agor/core/config';
import type { Database } from '@agor/core/db';
import { SessionMCPServerRepository, SessionRepository } from '@agor/core/db';
import { BadRequest, Forbidden } from '@agor/core/feathers';
import { buildMCPTemplateContextFromEnv, resolveMcpServerTemplates } from '@agor/core/mcp';
import { resolveMCPAuthHeaders } from '@agor/core/tools/mcp/jwt-auth';
import type { MCPServer, Params, Session, UserID, Worktree } from '@agor/core/types';
import type { Application } from '../declarations.js';

interface PiMcpToolCallData {
  session_id: string;
  mcp_server_id: string;
  tool_name: string;
  arguments?: Record<string, unknown>;
}

interface PiMcpToolCallParams extends Params {
  session?: Session;
  worktree?: Worktree;
}

interface PiMcpToolCallResult {
  content: Array<
    | {
        type: 'text';
        text: string;
      }
    | {
        type: 'image';
        data: string;
        mimeType: string;
      }
  >;
  is_error: boolean;
  server_id: string;
  server_name: string;
  tool_name: string;
  details?: Record<string, unknown>;
}

export class PiMcpToolsService {
  app?: Application;
  private sessionRepo: SessionRepository;
  private sessionMcpRepo: SessionMCPServerRepository;

  constructor(private db: Database) {
    this.sessionRepo = new SessionRepository(db);
    this.sessionMcpRepo = new SessionMCPServerRepository(db);
  }

  setup(app: Application): void {
    this.app = app;
  }

  private requireApp(): Application {
    if (!this.app) {
      throw new Error('PiMcpToolsService.setup() must run before use');
    }

    return this.app;
  }

  private async withTimeout<T>(label: string, promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  }

  private normalizeContent(result: unknown): PiMcpToolCallResult['content'] {
    const blocks = (result as { content?: unknown[] })?.content;

    if (!Array.isArray(blocks) || blocks.length === 0) {
      if ((result as { toolResult?: unknown })?.toolResult !== undefined) {
        return [
          {
            type: 'text',
            text: JSON.stringify((result as { toolResult?: unknown }).toolResult, null, 2),
          },
        ];
      }

      return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
    }

    return blocks.map((block) => {
      if (
        block &&
        typeof block === 'object' &&
        'type' in block &&
        block.type === 'text' &&
        'text' in block &&
        typeof block.text === 'string'
      ) {
        return {
          type: 'text' as const,
          text: block.text,
        };
      }

      if (
        block &&
        typeof block === 'object' &&
        'type' in block &&
        block.type === 'image' &&
        'data' in block &&
        typeof block.data === 'string' &&
        'mimeType' in block &&
        typeof block.mimeType === 'string'
      ) {
        return {
          type: 'image' as const,
          data: block.data,
          mimeType: block.mimeType,
        };
      }

      if (
        block &&
        typeof block === 'object' &&
        'type' in block &&
        block.type === 'resource' &&
        'resource' in block &&
        block.resource &&
        typeof block.resource === 'object'
      ) {
        const resource = block.resource as { uri?: string; text?: string; blob?: string };
        if (typeof resource.text === 'string') {
          return {
            type: 'text' as const,
            text: resource.text,
          };
        }

        return {
          type: 'text' as const,
          text: JSON.stringify(resource, null, 2),
        };
      }

      return {
        type: 'text' as const,
        text: JSON.stringify(block, null, 2),
      };
    });
  }

  private async resolveSession(
    params: PiMcpToolCallParams,
    data: PiMcpToolCallData
  ): Promise<Session> {
    if (params.session) {
      return params.session;
    }

    const session = await this.sessionRepo.findById(data.session_id);
    if (!session) {
      throw new Forbidden(`Session not found: ${data.session_id}`);
    }

    return session;
  }

  private async resolveScopedServers(session: Session): Promise<MCPServer[]> {
    const app = this.requireApp();
    const createdBy = session.created_by as UserID;
    const userEnv = await createUserProcessEnvironment(createdBy, this.db);
    const templateContext = buildMCPTemplateContextFromEnv(userEnv);
    const seenServerIds = new Set<string>();
    const scopedServers: MCPServer[] = [];

    const globalResult = await app.service('mcp-servers').find({
      provider: undefined,
      query: {
        scope: 'global',
        enabled: true,
        forUserId: createdBy,
        $limit: 1000,
      },
    });
    const globalServers = (
      Array.isArray(globalResult) ? globalResult : globalResult.data
    ) as MCPServer[];

    for (const server of globalServers) {
      if (seenServerIds.has(server.mcp_server_id)) {
        continue;
      }

      seenServerIds.add(server.mcp_server_id);
      scopedServers.push(server);
    }

    const sessionServers = await this.sessionMcpRepo.listServers(session.session_id, true);
    for (const server of sessionServers) {
      if (seenServerIds.has(server.mcp_server_id)) {
        continue;
      }

      seenServerIds.add(server.mcp_server_id);
      scopedServers.push(server);
    }

    return scopedServers.flatMap((server) => {
      const resolved = resolveMcpServerTemplates(server, templateContext);
      if (!resolved.isValid) {
        console.warn(
          `[Pi MCP] Skipping MCP server "${server.name}" for session ${session.session_id.substring(0, 8)}: ${resolved.errorMessage}`
        );
        return [];
      }

      return [resolved.server];
    });
  }

  private async connectToServer(
    server: MCPServer,
    session: Session,
    worktreePath?: string
  ): Promise<{
    client: {
      connect: (transport: unknown) => Promise<void>;
      callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
    };
    transport: {
      close: () => Promise<void> | void;
    };
  }> {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const createdBy = session.created_by as UserID;

    if (server.transport === 'stdio') {
      if (!server.command) {
        throw new BadRequest(`MCP server ${server.name} is missing its command`);
      }

      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args ?? [],
        env: await createUserProcessEnvironment(createdBy, this.db, server.env),
        cwd: worktreePath,
      });
      const client = new Client(
        { name: 'agor-pi-mcp', version: '1.0.0' },
        { capabilities: {} }
      ) as {
        connect: (transport: unknown) => Promise<void>;
        callTool: (params: {
          name: string;
          arguments?: Record<string, unknown>;
        }) => Promise<unknown>;
      };
      return { client, transport };
    }

    if (!server.url) {
      throw new BadRequest(`MCP server ${server.name} is missing its URL`);
    }

    const headers = {
      Accept: 'application/json, text/event-stream',
      ...(await resolveMCPAuthHeaders(server.auth, server.url)),
    };

    if (server.transport === 'http') {
      const { StreamableHTTPClientTransport } = await import(
        '@modelcontextprotocol/sdk/client/streamableHttp.js'
      );

      let mcpSessionId: string | undefined;
      const sessionAwareFetch: typeof fetch = async (input, init) => {
        const headerMap = new Headers(init?.headers ?? {});
        if (mcpSessionId && !headerMap.has('mcp-session-id')) {
          headerMap.set('mcp-session-id', mcpSessionId);
        }

        const response = await fetch(input, {
          ...init,
          headers: headerMap,
        });

        const responseSessionId = response.headers.get('mcp-session-id');
        if (responseSessionId) {
          mcpSessionId = responseSessionId;
        }

        return response;
      };

      const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        fetch: sessionAwareFetch,
        requestInit: { headers },
      });
      const client = new Client(
        { name: 'agor-pi-mcp', version: '1.0.0' },
        { capabilities: {} }
      ) as {
        connect: (transport: unknown) => Promise<void>;
        callTool: (params: {
          name: string;
          arguments?: Record<string, unknown>;
        }) => Promise<unknown>;
      };
      return { client, transport };
    }

    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
    const transport = new SSEClientTransport(new URL(server.url), {
      requestInit: { headers },
      eventSourceInit: {
        fetch: (input: string | URL | Request, init?: RequestInit) =>
          fetch(input, {
            ...init,
            headers: {
              ...headers,
              ...(init?.headers as Record<string, string> | undefined),
            },
          }),
      },
    });
    const client = new Client({ name: 'agor-pi-mcp', version: '1.0.0' }, { capabilities: {} }) as {
      connect: (transport: unknown) => Promise<void>;
      callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
    };
    return { client, transport };
  }

  /**
   * Execute a single scoped MCP tool call for Pi.
   */
  async create(
    data: PiMcpToolCallData,
    params?: PiMcpToolCallParams
  ): Promise<PiMcpToolCallResult> {
    if (!data.session_id || !data.mcp_server_id || !data.tool_name) {
      throw new BadRequest('session_id, mcp_server_id, and tool_name are required');
    }

    if (data.arguments && typeof data.arguments !== 'object') {
      throw new BadRequest('arguments must be an object when provided');
    }

    const session = await this.resolveSession(params ?? {}, data);
    const worktreePath = params?.worktree?.path;
    const scopedServers = await this.resolveScopedServers(session);
    const server = scopedServers.find(
      (candidate) => candidate.mcp_server_id === data.mcp_server_id
    );

    if (!server) {
      throw new Forbidden(
        `MCP server ${data.mcp_server_id} is not available to session ${data.session_id}`
      );
    }

    if (server.tools && server.tools.length > 0) {
      const toolExists = server.tools.some((tool) => tool.name === data.tool_name);
      if (!toolExists) {
        throw new Forbidden(
          `MCP tool ${data.tool_name} is not registered on server ${server.name}`
        );
      }
    }

    const { client, transport } = await this.connectToServer(server, session, worktreePath);

    try {
      await this.withTimeout('MCP connect', client.connect(transport), 10000);
      const rawResult = await this.withTimeout(
        `MCP tool ${data.tool_name}`,
        client.callTool({
          name: data.tool_name,
          arguments: data.arguments ?? {},
        }),
        30000
      );

      return {
        content: this.normalizeContent(rawResult),
        is_error: Boolean((rawResult as { isError?: boolean }).isError),
        server_id: server.mcp_server_id,
        server_name: server.display_name || server.name,
        tool_name: data.tool_name,
        details: {
          structured_content: (rawResult as { structuredContent?: unknown }).structuredContent,
          raw_result: rawResult,
        },
      };
    } finally {
      await Promise.resolve(transport.close()).catch(() => {});
    }
  }
}

export function createPiMcpToolsService(db: Database): PiMcpToolsService {
  return new PiMcpToolsService(db);
}
