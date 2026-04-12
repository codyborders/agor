/**
 * Pi MCP custom tool bridge.
 *
 * Converts Agor-scoped MCP servers into Pi custom tools and executes them
 * through the daemon's Pi MCP proxy service.
 */

import type { MCPServer, MCPTool, PiMcpToolCallResult, SessionID } from '@agor/core/types';
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { AgorClient } from '../../services/feathers-client.js';

interface PiMcpToolBridgeOptions {
  client: AgorClient;
  sessionId: SessionID;
  servers: MCPServer[];
  builtInToolNames: Set<string>;
}

interface PiBridgeToolDetails {
  isError: boolean;
  error?: string;
  serverId?: string;
  serverName?: string;
  toolName?: string;
}

function sanitizeToolToken(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || 'tool';
}

type PiToolSchema = ToolDefinition['parameters'];

function createFallbackSchema(tool: MCPTool): PiToolSchema {
  const schema =
    tool.input_schema && typeof tool.input_schema === 'object' ? { ...tool.input_schema } : {};

  if (schema.type !== 'object') {
    return {
      type: 'object',
      additionalProperties: true,
      description: tool.description,
    } as unknown as PiToolSchema;
  }

  if (!Object.hasOwn(schema, 'additionalProperties')) {
    schema.additionalProperties = true;
  }

  return schema as unknown as PiToolSchema;
}

function buildUniqueToolName(server: MCPServer, tool: MCPTool, reservedNames: Set<string>): string {
  const serverToken = sanitizeToolToken(server.display_name || server.name);
  const toolToken = sanitizeToolToken(tool.name);
  const serverSuffix = sanitizeToolToken(server.mcp_server_id).slice(0, 8);
  const baseName = `mcp__${serverToken}__${toolToken}`;

  if (!reservedNames.has(baseName)) {
    reservedNames.add(baseName);
    return baseName;
  }

  const suffixedName = `${baseName}__${serverSuffix}`;
  if (!reservedNames.has(suffixedName)) {
    reservedNames.add(suffixedName);
    return suffixedName;
  }

  let collisionIndex = 2;
  while (reservedNames.has(`${suffixedName}_${collisionIndex}`)) {
    collisionIndex += 1;
  }

  const collisionName = `${suffixedName}_${collisionIndex}`;
  reservedNames.add(collisionName);
  return collisionName;
}

function buildErrorResult(error: unknown, toolName: string) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: 'text' as const,
        text: `MCP tool ${toolName} failed: ${message}`,
      },
    ],
    details: {
      isError: true,
      error: message,
    } satisfies PiBridgeToolDetails,
  };
}

export function buildPiMcpTools(options: PiMcpToolBridgeOptions): ToolDefinition[] {
  const reservedNames = new Set(options.builtInToolNames);
  const mcpService = options.client.service('pi-mcp-tools') as unknown as {
    create(data: {
      session_id: string;
      mcp_server_id: string;
      tool_name: string;
      arguments?: Record<string, unknown>;
    }): Promise<PiMcpToolCallResult>;
  };

  return options.servers.flatMap((server) => {
    if (!server.tools || server.tools.length === 0) {
      return [];
    }

    return server.tools.map((tool) => {
      const piToolName = buildUniqueToolName(server, tool, reservedNames);
      const schema = createFallbackSchema(tool);

      return defineTool<PiToolSchema, PiBridgeToolDetails>({
        name: piToolName,
        label: `${server.display_name || server.name}: ${tool.name}`,
        description: `${tool.description}\n\nMCP server: ${server.display_name || server.name}`,
        parameters: schema,
        execute: async (_toolCallId, params) => {
          try {
            const result = await mcpService.create({
              session_id: options.sessionId,
              mcp_server_id: server.mcp_server_id,
              tool_name: tool.name,
              arguments: params as Record<string, unknown>,
            });

            return {
              content: result.content,
              details: {
                isError: result.is_error,
                serverId: result.server_id,
                serverName: result.server_name,
                toolName: result.tool_name,
                ...(result.details ?? {}),
              } satisfies PiBridgeToolDetails,
            };
          } catch (error) {
            return buildErrorResult(error, tool.name);
          }
        },
      });
    });
  });
}
