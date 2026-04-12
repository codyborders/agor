/**
 * Pi Packages Service
 *
 * Provides REST API for Pi package management (extensions, skills, themes).
 */

import type { Database } from '@agor/core/db';
import type { Params } from '@agor/core/types';
import { getPiPackageService } from '@agor/pi-runtime';
import { resolveOptionalWorktreePath } from './pi-service-helpers';

/**
 * Pi Packages Service
 */
export class PiPackagesService {
  constructor(private db: Database) {}

  private packageService = getPiPackageService();

  /**
   * List installed packages.
   * Query params:
   * - worktree_id?: string
   * - scope?: 'global' | 'project'
   * - kind?: 'extension' | 'skill' | 'theme' | 'prompt-template'
   */
  async find(
    params?: Params & {
      worktree_id?: string;
      scope?: 'global' | 'project';
      kind?: string;
    }
  ): Promise<unknown[]> {
    const worktreePath = await resolveOptionalWorktreePath(
      this.db,
      params?.query?.worktree_id as string | undefined
    );
    return this.packageService.listPackages({
      scope: params?.query?.scope,
      worktreePath,
      kind: params?.query?.kind as 'extension' | 'skill' | 'theme' | 'prompt-template' | undefined,
    });
  }

  /**
   * Get a specific package by ID.
   */
  async get(id: string, _params?: Params): Promise<unknown | null> {
    const packages = await this.packageService.listPackages({});
    return packages.find((p) => p.id === id) || null;
  }

  /**
   * Install a new package.
   * Body: { source: string, scope: 'global' | 'project', worktree_id?: string, persist?: boolean }
   */
  async create(
    data: {
      source: string;
      scope: 'global' | 'project';
      worktree_id?: string;
      persist?: boolean;
    },
    _params?: Params
  ): Promise<unknown> {
    const worktreePath = await resolveOptionalWorktreePath(this.db, data.worktree_id);
    return this.packageService.installPackage({
      source: data.source,
      scope: data.scope,
      worktreePath,
      persist: data.persist ?? true,
    });
  }

  /**
   * Update, enable, or disable a package.
   * Body: { action: 'update' | 'enable' | 'disable' }
   */
  async patch(
    id: string,
    data: { action: string; scope: 'global' | 'project'; worktree_id?: string },
    _params?: Params
  ): Promise<{ success: boolean }> {
    const { action, scope } = data;
    const worktreePath = await resolveOptionalWorktreePath(this.db, data.worktree_id);

    switch (action) {
      case 'update':
        await this.packageService.updatePackage({ packageId: id, scope, worktreePath });
        break;
      case 'enable':
        await this.packageService.enablePackage(id, scope, worktreePath);
        break;
      case 'disable':
        await this.packageService.disablePackage(id, scope, worktreePath);
        break;
      default:
        throw new Error(`Unknown package action: ${action}`);
    }

    return { success: true };
  }

  /**
   * Remove a package.
   */
  async remove(id: string, params?: Params): Promise<{ success: boolean }> {
    const scope = params?.query?.scope;
    if (scope !== 'global' && scope !== 'project') {
      throw new Error('Package removal requires query.scope to be "global" or "project"');
    }

    const worktreePath = await resolveOptionalWorktreePath(
      this.db,
      params?.query?.worktree_id as string | undefined
    );
    await this.packageService.removePackage(id, scope, worktreePath);
    return { success: true };
  }
}

/**
 * Create Pi Packages Service instance.
 */
export function createPiPackagesService(db: Database): PiPackagesService {
  return new PiPackagesService(db);
}
