/**
 * Pi Native Sessions Service
 *
 * Provides REST API for managing native Pi sessions.
 */

import type { Database } from '@agor/core/db';
import type { Params } from '@agor/core/types';
import { getPiSessionService } from '@agor/pi-runtime';
import { resolveOptionalWorktreePath } from './pi-service-helpers';

/**
 * Pi Native Sessions Service
 */
export class PiNativeSessionsService {
  constructor(private db: Database) {}

  private sessionService = getPiSessionService();

  /**
   * List native Pi root sessions.
   * Query params:
   * - worktree_id?: string - Filter by worktree (project-level sessions)
   * - include_tree?: boolean - Include full branch tree
   */
  async find(
    params?: Params & {
      worktree_id?: string;
      include_tree?: boolean;
    }
  ): Promise<unknown[]> {
    const worktreePath = await resolveOptionalWorktreePath(
      this.db,
      params?.query?.worktree_id as string | undefined
    );
    const sessions = await this.sessionService.listSessions(worktreePath);

    if (params?.query?.include_tree) {
      // Return full trees instead of summaries
      const trees = await Promise.all(
        sessions.map((s) => this.sessionService.getSessionTree(s.root_session_id, worktreePath))
      );
      return trees;
    }

    return sessions;
  }

  /**
   * Get a specific native session tree.
   */
  async get(id: string, params?: Params): Promise<unknown> {
    const worktreePath = await resolveOptionalWorktreePath(
      this.db,
      params?.query?.worktree_id as string | undefined
    );
    return this.sessionService.getSessionTree(id, worktreePath);
  }

  /**
   * Import native sessions into Agor.
   * Body: { worktree_id?: string, root_session_id: string, branch_ids?: string[] }
   */
  async create(
    data: { worktree_id?: string; root_session_id: string; branch_ids?: string[] },
    _params?: Params
  ): Promise<unknown> {
    const worktreePath = await resolveOptionalWorktreePath(this.db, data.worktree_id);

    // Get the session tree
    const tree = await this.sessionService.getSessionTree(data.root_session_id, worktreePath);

    // For now, just return the tree - actual import into Agor would create Session records
    return {
      imported: true,
      root_session_id: data.root_session_id,
      tree,
    };
  }
}

/**
 * Create Pi Native Sessions Service instance.
 */
export function createPiNativeSessionsService(db: Database): PiNativeSessionsService {
  return new PiNativeSessionsService(db);
}
