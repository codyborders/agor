/**
 * Pi Files Service
 *
 * Provides REST API for reading/writing Pi config files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Database } from '@agor/core/db';
import type { Params } from '@agor/core/types';
import { getPiEnvironmentManager } from '@agor/pi-runtime';
import { resolveOptionalWorktreePath } from './pi-service-helpers';

type FileId = 'global-settings' | 'project-settings' | 'models';

/**
 * Pi Files Service
 */
export class PiFilesService {
  constructor(private db: Database) {}

  private envManager = getPiEnvironmentManager();

  private async resolveDocumentPath(id: FileId, worktreePath?: string): Promise<string> {
    if (id === 'project-settings') {
      if (!worktreePath) {
        return this.envManager.resolveConfigPath('settings');
      }
      return path.join(worktreePath, '.pi', 'settings.json');
    }

    return this.envManager.resolveConfigPath(
      id === 'global-settings' ? 'settings' : id,
      worktreePath
    );
  }

  /**
   * Get a Pi config file.
   * Params:
   * - worktree_id?: string - For project-level files
   */
  async get(
    id: FileId,
    params?: Params
  ): Promise<{
    id: string;
    data?: Record<string, unknown>;
    raw?: string;
    parsed: boolean;
    parse_error?: string;
    file_path: string;
    last_modified: string;
  }> {
    const worktreePath = await resolveOptionalWorktreePath(
      this.db,
      params?.query?.worktree_id as string | undefined
    );
    const filePath = await this.resolveDocumentPath(id, worktreePath);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      let data: Record<string, unknown> | undefined;
      let parseError: string | undefined;

      try {
        data = JSON.parse(content);
      } catch {
        parseError = 'Failed to parse JSON';
      }

      const stats = await fs.stat(filePath);

      return {
        id,
        data,
        raw: data === undefined ? content : undefined,
        parsed: data !== undefined,
        parse_error: parseError,
        file_path: filePath,
        last_modified: stats.mtime.toISOString(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          id,
          parsed: false,
          file_path: filePath,
          last_modified: new Date().toISOString(),
        };
      }
      throw error;
    }
  }

  /**
   * Update a Pi config file.
   * Body: { mode: 'structured' | 'raw', data: Record<string, unknown> | string }
   */
  async patch(
    id: FileId,
    data: { mode: 'structured' | 'raw'; data: Record<string, unknown> | string },
    params?: Params
  ): Promise<{ success: boolean; file_path: string }> {
    const worktreePath = await resolveOptionalWorktreePath(
      this.db,
      params?.query?.worktree_id as string | undefined
    );
    const filePath = await this.resolveDocumentPath(id, worktreePath);

    let content: string;
    if (data.mode === 'structured') {
      content = JSON.stringify(data.data, null, 2);
    } else {
      content = data.data as string;
    }

    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');

    // Invalidate cache since files changed
    this.envManager.invalidateCache();

    return { success: true, file_path: filePath };
  }
}

/**
 * Create Pi Files Service instance.
 */
export function createPiFilesService(db: Database): PiFilesService {
  return new PiFilesService(db);
}
