// src/session-service.ts

/**
 * PiSessionService - manages native Pi sessions.
 *
 * Handles:
 * - Session creation (new native Pi root sessions)
 * - Session resumption (switching to a branch)
 * - Session forking (creating branches within a root session)
 * - Session spawning (creating new root sessions linked via Agor genealogy)
 * - Session import (importing existing native Pi sessions into Agor)
 * - Session listing (discovering native Pi sessions)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { PiEnvironmentManager } from './environment-manager.js';
import { getPiEnvironmentManager } from './environment-manager.js';
import type {
  CreateSessionOptions,
  ForkSessionOptions,
  PiNativeBinding,
  PiNativeSessionSummary,
  PiNativeSessionTree,
  PiToolOptions,
  ResumeSessionOptions,
} from './types.js';

export class PiSessionService {
  private envManager = getPiEnvironmentManager();

  /**
   * Create a new native Pi session.
   */
  async createSession(options: CreateSessionOptions): Promise<PiNativeBinding> {
    const worktreePath = options.worktreePath;
    const paths = await this.envManager.getPaths(worktreePath);

    // Determine session file path
    const sessionDir =
      options.worktreePath && paths.projectSessionsPath
        ? paths.projectSessionsPath
        : paths.globalSessionsPath;

    // Ensure directory exists
    await fs.mkdir(sessionDir, { recursive: true });

    // Generate unique root session ID
    const rootSessionId = `pi_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const branchId = `${rootSessionId}/main`;

    // Create session file path
    const sessionFilePath = path.join(sessionDir, `${rootSessionId}.json`);

    // Session file structure (simplified - actual Pi format may differ)
    const sessionData = {
      id: rootSessionId,
      branches: [
        {
          id: branchId,
          label: options.branchLabel || 'main',
          parent_id: null,
          created_at: new Date().toISOString(),
          last_modified: new Date().toISOString(),
        },
      ],
      active_branch_id: branchId,
      created_at: new Date().toISOString(),
      tool_options: options.toolOptions || {},
    };

    await fs.writeFile(sessionFilePath, JSON.stringify(sessionData, null, 2));

    return {
      root_session_id: rootSessionId,
      branch_id: branchId,
      session_file_path: sessionFilePath,
      branch_label: options.branchLabel || 'main',
      imported: false,
      last_synced_at: new Date().toISOString(),
    };
  }

  /**
   * Resume an existing native Pi session (switch to a branch).
   */
  async resumeSession(options: ResumeSessionOptions): Promise<PiNativeBinding> {
    const paths = await this.envManager.getPaths(options.worktreePath);

    // Find the session file
    const sessionFilePath = await this.findSessionFile(options.rootSessionId, paths);

    if (!sessionFilePath) {
      throw new Error(`Session not found: ${options.rootSessionId}`);
    }

    // Read and validate session
    const sessionContent = await fs.readFile(sessionFilePath, 'utf-8');
    const sessionData = JSON.parse(sessionContent);

    const branch = sessionData.branches?.find((b: { id: string }) => b.id === options.branchId);
    if (!branch) {
      throw new Error(`Branch not found: ${options.branchId}`);
    }

    return {
      root_session_id: options.rootSessionId,
      branch_id: options.branchId,
      session_file_path: sessionFilePath,
      branch_label: branch.label,
      imported: true,
      last_synced_at: new Date().toISOString(),
    };
  }

  /**
   * Fork a session (create a new branch).
   */
  async forkSession(options: ForkSessionOptions): Promise<PiNativeBinding> {
    const paths = await this.envManager.getPaths(options.worktreePath);

    // Find the parent session file
    const sessionFilePath = await this.findSessionFile(options.parentRootSessionId, paths);

    if (!sessionFilePath) {
      throw new Error(`Session not found: ${options.parentRootSessionId}`);
    }

    // Read session
    const sessionContent = await fs.readFile(sessionFilePath, 'utf-8');
    const sessionData = JSON.parse(sessionContent);

    // Create new branch
    const newBranchId = `${options.parentRootSessionId}/${Date.now()}`;
    const newBranch = {
      id: newBranchId,
      label: options.newBranchLabel || `branch-${Date.now()}`,
      parent_id: options.sourceBranchId,
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    };

    sessionData.branches.push(newBranch);
    sessionData.last_modified = new Date().toISOString();

    // Write updated session
    await fs.writeFile(sessionFilePath, JSON.stringify(sessionData, null, 2));

    return {
      root_session_id: options.parentRootSessionId,
      branch_id: newBranchId,
      session_file_path: sessionFilePath,
      branch_label: newBranch.label,
      imported: false,
      last_synced_at: new Date().toISOString(),
    };
  }

  /**
   * List native Pi sessions.
   */
  async listSessions(worktreePath?: string): Promise<PiNativeSessionSummary[]> {
    const paths = await this.envManager.getPaths(worktreePath);
    const sessions: PiNativeSessionSummary[] = [];

    // Check global sessions
    try {
      const globalSessions = await this.listSessionsInDir(paths.globalSessionsPath);
      sessions.push(...globalSessions);
    } catch {
      // Directory doesn't exist
    }

    // Check project sessions
    if (paths.projectSessionsPath) {
      try {
        const projectSessions = await this.listSessionsInDir(paths.projectSessionsPath);
        sessions.push(...projectSessions);
      } catch {
        // Directory doesn't exist
      }
    }

    return sessions;
  }

  /**
   * Get full session tree for a root session.
   */
  async getSessionTree(rootSessionId: string, worktreePath?: string): Promise<PiNativeSessionTree> {
    const paths = await this.envManager.getPaths(worktreePath);
    const sessionFilePath = await this.findSessionFile(rootSessionId, paths);

    if (!sessionFilePath) {
      throw new Error(`Session not found: ${rootSessionId}`);
    }

    const sessionContent = await fs.readFile(sessionFilePath, 'utf-8');
    const sessionData = JSON.parse(sessionContent);

    const branches = sessionData.branches.map(
      (b: {
        id: string;
        label?: string;
        parent_id?: string;
        created_at: string;
        last_modified: string;
      }) => ({
        branch_id: b.id,
        parent_branch_id: b.parent_id,
        label: b.label,
        created_at: b.created_at,
        last_modified: b.last_modified,
      })
    );

    return {
      summary: {
        root_session_id: rootSessionId,
        session_file_path: sessionFilePath,
        current_branch_id: sessionData.active_branch_id,
        current_branch_label: branches.find(
          (b: { branch_id: string }) => b.branch_id === sessionData.active_branch_id
        )?.label,
        last_modified: sessionData.last_modified,
        branch_count: branches.length,
      },
      branches,
      active_branch_id: sessionData.active_branch_id,
    };
  }

  /**
   * Update tool options for a session branch.
   */
  async updateToolOptions(
    rootSessionId: string,
    branchId: string,
    toolOptions: PiToolOptions,
    worktreePath?: string
  ): Promise<void> {
    const paths = await this.envManager.getPaths(worktreePath);
    const sessionFilePath = await this.findSessionFile(rootSessionId, paths);

    if (!sessionFilePath) {
      throw new Error(`Session not found: ${rootSessionId}`);
    }

    const sessionContent = await fs.readFile(sessionFilePath, 'utf-8');
    const sessionData = JSON.parse(sessionContent);

    // Update branch tool options
    const branch = sessionData.branches.find((b: { id: string }) => b.id === branchId);
    if (branch) {
      branch.tool_options = { ...branch.tool_options, ...toolOptions };
      branch.last_modified = new Date().toISOString();
      sessionData.last_modified = new Date().toISOString();
      await fs.writeFile(sessionFilePath, JSON.stringify(sessionData, null, 2));
    }
  }

  /**
   * Find session file by root session ID.
   */
  private async findSessionFile(
    rootSessionId: string,
    paths: Awaited<ReturnType<PiEnvironmentManager['getPaths']>>
  ): Promise<string | null> {
    // Search in global sessions
    try {
      const globalFile = path.join(paths.globalSessionsPath, `${rootSessionId}.json`);
      await fs.access(globalFile);
      return globalFile;
    } catch {
      // Not in global
    }

    // Search in project sessions
    if (paths.projectSessionsPath) {
      try {
        const projectFile = path.join(paths.projectSessionsPath, `${rootSessionId}.json`);
        await fs.access(projectFile);
        return projectFile;
      } catch {
        // Not in project
      }
    }

    return null;
  }

  /**
   * List sessions in a directory.
   */
  private async listSessionsInDir(dirPath: string): Promise<PiNativeSessionSummary[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const sessions: PiNativeSessionSummary[] = [];

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const filePath = path.join(dirPath, entry.name);
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);

          sessions.push({
            root_session_id: data.id,
            session_file_path: filePath,
            current_branch_id: data.active_branch_id,
            current_branch_label: data.branches?.find(
              (b: { id: string }) => b.id === data.active_branch_id
            )?.label,
            last_modified: data.last_modified,
            branch_count: data.branches?.length || 1,
          });
        } catch {
          // Skip invalid session files
        }
      }
    }

    return sessions;
  }
}

let sessionServiceInstance: PiSessionService | null = null;

export function getPiSessionService(): PiSessionService {
  if (!sessionServiceInstance) {
    sessionServiceInstance = new PiSessionService();
  }
  return sessionServiceInstance;
}
