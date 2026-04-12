/**
 * Pi Runtime Service
 *
 * Provides REST API for Pi runtime status, paths, and catalog information.
 */

import type { Database } from '@agor/core/db';
import type { Params } from '@agor/core/types';
import { getPiCatalogService, getPiEnvironmentManager } from '@agor/pi-runtime';
import { resolveOptionalWorktreePath } from './pi-service-helpers';

/**
 * Pi Runtime Service
 */
export class PiRuntimeService {
  constructor(private db: Database) {}

  private envManager = getPiEnvironmentManager();
  private catalogService = getPiCatalogService();

  /**
   * Get Pi runtime status.
   * Query params:
   * - worktree_id: Optional worktree ID to get project-level paths
   */
  async find(params?: Params & { worktree_id?: string }): Promise<unknown> {
    const worktreePath = await resolveOptionalWorktreePath(
      this.db,
      params?.query?.worktree_id as string | undefined
    );
    return this.envManager.getStatus(worktreePath);
  }

  /**
   * Get available models from Pi catalog.
   */
  async getModels(_params?: Params): Promise<string[]> {
    return this.catalogService.getModels();
  }

  /**
   * Get available slash commands.
   */
  async getSlashCommands(_params?: Params): Promise<unknown[]> {
    return this.catalogService.getSlashCommands();
  }

  /**
   * Get available extension commands.
   */
  async getExtensionCommands(_params?: Params): Promise<unknown[]> {
    return this.catalogService.getExtensionCommands();
  }

  /**
   * Get available themes.
   */
  async getThemes(_params?: Params): Promise<string[]> {
    return this.catalogService.getThemes();
  }

  /**
   * Invalidate cached paths and status.
   */
  async invalidateCache(_params?: Params): Promise<{ invalidated: boolean }> {
    this.envManager.invalidateCache();
    return { invalidated: true };
  }
}

/**
 * Create Pi Runtime Service instance.
 */
export function createPiRuntimeService(db: Database): PiRuntimeService {
  return new PiRuntimeService(db);
}
