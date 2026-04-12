// src/session-service.ts

/**
 * PiSessionService - manages native Pi sessions.
 *
 * Uses Pi's real SessionManager and JSONL session files rather than a parallel
 * Agor-only format.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { getPiEnvironmentManager } from './environment-manager.js';
import type {
  CreateSessionOptions,
  ForkSessionOptions,
  PiNativeBinding,
  PiNativeBranch,
  PiNativeSessionSummary,
  PiNativeSessionTree,
  PiToolOptions,
  ResumeSessionOptions,
} from './types.js';

export class PiSessionService {
  private envManager = getPiEnvironmentManager();

  private getEffectiveCwd(worktreePath?: string): string {
    return path.resolve(worktreePath ?? process.cwd());
  }

  private async getSessionDir(worktreePath?: string): Promise<string> {
    return this.envManager.resolveSessionDir(worktreePath);
  }

  private countLeafNodes(branches: PiNativeBranch[]): number {
    if (branches.length === 0) {
      return 0;
    }

    const parentBranchIds = new Set(
      branches
        .map((branch) => branch.parent_branch_id)
        .filter((branchId): branchId is string => Boolean(branchId))
    );

    return branches.filter((branch) => !parentBranchIds.has(branch.branch_id)).length;
  }

  private getBranchLabel(sessionManager: SessionManager, branchId: string): string | undefined {
    const explicitLabel = sessionManager.getLabel(branchId);
    if (explicitLabel) {
      return explicitLabel;
    }

    if (sessionManager.getLeafId() === branchId) {
      return sessionManager.getSessionName();
    }

    return undefined;
  }

  private mapBranches(sessionManager: SessionManager): PiNativeBranch[] {
    return sessionManager.getEntries().map((entry) => ({
      branch_id: entry.id,
      parent_branch_id: entry.parentId ?? undefined,
      label: this.getBranchLabel(sessionManager, entry.id),
      created_at: entry.timestamp,
      last_modified: entry.timestamp,
    }));
  }

  private async buildSummary(
    sessionManager: SessionManager,
    sessionFilePath: string
  ): Promise<PiNativeSessionSummary> {
    const branches = this.mapBranches(sessionManager);
    const leafId = sessionManager.getLeafId() ?? '';
    const stats = await fs.stat(sessionFilePath);

    return {
      root_session_id: sessionManager.getSessionId(),
      session_file_path: sessionFilePath,
      current_branch_id: leafId,
      current_branch_label: leafId ? this.getBranchLabel(sessionManager, leafId) : undefined,
      last_modified: stats.mtime.toISOString(),
      branch_count: this.countLeafNodes(branches),
    };
  }

  private async openSession(
    rootSessionId: string,
    worktreePath?: string
  ): Promise<{ sessionFilePath: string; sessionManager: SessionManager }> {
    const sessionFilePath = await this.findSessionFile(rootSessionId, worktreePath);
    if (!sessionFilePath) {
      throw new Error(`Session not found: ${rootSessionId}`);
    }

    const sessionDir = await this.getSessionDir(worktreePath);
    const cwd = this.getEffectiveCwd(worktreePath);
    const sessionManager = SessionManager.open(sessionFilePath, sessionDir, cwd);
    return { sessionFilePath, sessionManager };
  }

  /**
   * Create a new native Pi session.
   */
  async createSession(options: CreateSessionOptions): Promise<PiNativeBinding> {
    const cwd = this.getEffectiveCwd(options.worktreePath);
    const sessionDir = await this.getSessionDir(options.worktreePath);
    const sessionManager = SessionManager.create(cwd, sessionDir);
    const sessionFilePath = sessionManager.newSession(
      options.parentSessionId ? { parentSession: options.parentSessionId } : undefined
    );

    if (!sessionFilePath) {
      throw new Error('Pi session creation did not produce a session file');
    }

    const branchLabel = options.branchLabel?.trim();
    if (branchLabel) {
      sessionManager.appendSessionInfo(branchLabel);
    }

    return {
      root_session_id: sessionManager.getSessionId(),
      branch_id: sessionManager.getLeafId() ?? '',
      session_file_path: sessionFilePath,
      branch_label: branchLabel || undefined,
      imported: false,
      last_synced_at: new Date().toISOString(),
    };
  }

  /**
   * Resume an existing native Pi session (switch to a branch).
   */
  async resumeSession(options: ResumeSessionOptions): Promise<PiNativeBinding> {
    const { sessionFilePath, sessionManager } = await this.openSession(
      options.rootSessionId,
      options.worktreePath
    );

    if (options.branchId) {
      const branchEntry = sessionManager.getEntry(options.branchId);
      if (!branchEntry) {
        throw new Error(`Branch not found: ${options.branchId}`);
      }

      if (sessionManager.getLeafId() !== options.branchId) {
        sessionManager.branch(options.branchId);
      }
    }

    return {
      root_session_id: options.rootSessionId,
      branch_id: options.branchId,
      session_file_path: sessionFilePath,
      branch_label: options.branchId
        ? this.getBranchLabel(sessionManager, options.branchId)
        : sessionManager.getSessionName(),
      imported: true,
      last_synced_at: new Date().toISOString(),
    };
  }

  /**
   * Fork a session by returning a binding anchored to the requested source branch.
   *
   * Pi creates the actual divergent branch lazily on the next appended entry.
   */
  async forkSession(options: ForkSessionOptions): Promise<PiNativeBinding> {
    const { sessionFilePath, sessionManager } = await this.openSession(
      options.parentRootSessionId,
      options.worktreePath
    );

    const sourceBranch = sessionManager.getEntry(options.sourceBranchId);
    if (!sourceBranch) {
      throw new Error(`Branch not found: ${options.sourceBranchId}`);
    }

    return {
      root_session_id: options.parentRootSessionId,
      branch_id: options.sourceBranchId,
      session_file_path: sessionFilePath,
      branch_label:
        options.newBranchLabel?.trim() ||
        this.getBranchLabel(sessionManager, options.sourceBranchId),
      imported: false,
      last_synced_at: new Date().toISOString(),
    };
  }

  /**
   * List native Pi sessions.
   */
  async listSessions(worktreePath?: string): Promise<PiNativeSessionSummary[]> {
    if (worktreePath) {
      const cwd = this.getEffectiveCwd(worktreePath);
      const sessionDir = await this.getSessionDir(worktreePath);
      const sessions = await SessionManager.list(cwd, sessionDir);

      return Promise.all(
        sessions.map(async (session) => {
          const sessionManager = SessionManager.open(session.path, sessionDir, cwd);
          return this.buildSummary(sessionManager, session.path);
        })
      );
    }

    const sessions = await SessionManager.listAll();
    return Promise.all(
      sessions.map(async (session) => {
        const sessionManager = SessionManager.open(session.path);
        return this.buildSummary(sessionManager, session.path);
      })
    );
  }

  /**
   * Get full session tree for a root session.
   */
  async getSessionTree(rootSessionId: string, worktreePath?: string): Promise<PiNativeSessionTree> {
    const { sessionFilePath, sessionManager } = await this.openSession(rootSessionId, worktreePath);
    const branches = this.mapBranches(sessionManager);

    return {
      summary: await this.buildSummary(sessionManager, sessionFilePath),
      branches,
      active_branch_id: sessionManager.getLeafId() ?? '',
    };
  }

  /**
   * Pi does not expose native per-branch tool option storage.
   * Agor stores these settings on the Agor session record instead.
   */
  async updateToolOptions(
    rootSessionId: string,
    branchId: string,
    _toolOptions: PiToolOptions,
    worktreePath?: string
  ): Promise<void> {
    const { sessionManager } = await this.openSession(rootSessionId, worktreePath);
    const branch = sessionManager.getEntry(branchId);

    if (!branch) {
      throw new Error(`Branch not found: ${branchId}`);
    }

    throw new Error(
      'Pi native sessions do not support persisted per-branch tool options. Store these on the Agor session record instead.'
    );
  }

  /**
   * Find session file by root session ID.
   */
  private async findSessionFile(
    rootSessionId: string,
    worktreePath?: string
  ): Promise<string | null> {
    if (worktreePath) {
      const cwd = this.getEffectiveCwd(worktreePath);
      const sessionDir = await this.getSessionDir(worktreePath);
      const sessions = await SessionManager.list(cwd, sessionDir);
      const session = sessions.find((candidate) => candidate.id === rootSessionId);
      return session?.path ?? null;
    }

    const sessions = await SessionManager.listAll();
    const session = sessions.find((candidate) => candidate.id === rootSessionId);
    return session?.path ?? null;
  }
}

let sessionServiceInstance: PiSessionService | null = null;

export function getPiSessionService(): PiSessionService {
  if (!sessionServiceInstance) {
    sessionServiceInstance = new PiSessionService();
  }
  return sessionServiceInstance;
}
