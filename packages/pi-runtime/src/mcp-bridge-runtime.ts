// src/mcp-bridge-runtime.ts

/**
 * PiMcpBridgeRuntime - bridges Agor MCP servers into Pi sessions.
 *
 * This is a runtime-only bridge that:
 * - Generates an Agor runtime manifest for each Pi session
 * - Exposes MCP tools as Pi tools during the session
 * - Handles tool name collision resolution
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { McpBridgeConfig } from './types.js';

const RUNTIME_BASE = '.agor/runtime/pi';

export class PiMcpBridgeRuntime {
  private manifestDir: string;

  constructor() {
    this.manifestDir = path.join(os.homedir(), RUNTIME_BASE);
  }

  /**
   * Generate MCP bridge manifest for a Pi session.
   */
  async generateManifest(sessionId: string, config: McpBridgeConfig): Promise<string> {
    // Create session-specific directory
    const sessionDir = path.join(this.manifestDir, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    // Create manifest file
    const manifest = {
      version: '1.0',
      generated_at: new Date().toISOString(),
      server_url: config.serverUrl,
      session_token: config.sessionToken,
      servers: config.servers.map((s) => ({
        id: s.id,
        name: s.name,
        command: s.command,
        args: s.args || [],
        env: {
          ...s.env,
          AGOR_SESSION_TOKEN: config.sessionToken,
          AGOR_WORKTREE_PATH: config.worktreePath,
          AGOR_USER_ID: config.userId,
        },
      })),
      worktree_path: config.worktreePath,
      user_id: config.userId,
    };

    const manifestPath = path.join(sessionDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    return manifestPath;
  }

  /**
   * Get manifest path for a session.
   */
  getManifestPath(sessionId: string): string {
    return path.join(this.manifestDir, sessionId, 'manifest.json');
  }

  /**
   * Read manifest for a session.
   */
  async readManifest(sessionId: string): Promise<McpBridgeConfig | null> {
    const manifestPath = this.getManifestPath(sessionId);
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      return {
        serverUrl: manifest.server_url,
        sessionToken: manifest.session_token,
        servers: manifest.servers,
        worktreePath: manifest.worktree_path,
        userId: manifest.user_id,
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete manifest for a session (cleanup).
   */
  async deleteManifest(sessionId: string): Promise<void> {
    const sessionDir = path.join(this.manifestDir, sessionId);
    try {
      await fs.rm(sessionDir, { recursive: true });
    } catch {
      // Ignore errors
    }
  }

  /**
   * Check if manifest exists for a session.
   */
  async hasManifest(sessionId: string): Promise<boolean> {
    const manifestPath = this.getManifestPath(sessionId);
    try {
      await fs.access(manifestPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve tool name collisions by prefixing with server ID.
   */
  resolveToolNameCollision(toolName: string, existingTools: Set<string>): string {
    // Simple collision resolution: prefix with underscore if collision
    if (existingTools.has(toolName)) {
      return `_${toolName}`;
    }
    return toolName;
  }
}

let mcpBridgeInstance: PiMcpBridgeRuntime | null = null;

export function getPiMcpBridgeRuntime(): PiMcpBridgeRuntime {
  if (!mcpBridgeInstance) {
    mcpBridgeInstance = new PiMcpBridgeRuntime();
  }
  return mcpBridgeInstance;
}
