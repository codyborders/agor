/**
 * Pi Auth Service
 *
 * Provides REST API for Pi authentication provider management.
 */

import type { Database } from '@agor/core/db';
import type { Params } from '@agor/core/types';
import { getPiAuthService } from '@agor/pi-runtime';
import { resolveOptionalWorktreePath } from './pi-service-helpers';

/**
 * Pi Auth Service
 */
export class PiAuthService {
  constructor(private db: Database) {}

  private authService = getPiAuthService();

  /**
   * List all auth providers and their status.
   */
  async find(_params?: Params): Promise<unknown[]> {
    return this.authService.listProviders();
  }

  /**
   * Get status of a specific provider.
   */
  async get(id: string, _params?: Params): Promise<unknown | null> {
    const providers = await this.authService.listProviders();
    return providers.find((p) => p.provider_id === id) || null;
  }

  /**
   * Start OAuth login flow.
   * Body: { action: 'login', provider_id: string, worktree_id?: string, callback_port?: number }
   */
  async create(
    data: { action: string; provider_id: string; worktree_id?: string; callback_port?: number },
    _params?: Params
  ): Promise<{ state_machine_token: string; auth_url: string }> {
    if (data.action !== 'login') {
      throw new Error(`Unknown auth action: ${data.action}`);
    }

    const worktreePath = await resolveOptionalWorktreePath(this.db, data.worktree_id);
    const result = await this.authService.startLogin({
      providerId: data.provider_id,
      worktreePath,
      callbackPort: data.callback_port,
    });

    return {
      state_machine_token: result.stateMachineToken,
      auth_url: result.authUrl,
    };
  }

  /**
   * Update provider auth (e.g., set API key).
   * Body: { action: 'set_api_key', api_key: string }
   */
  async patch(
    id: string,
    data: { action: string; api_key?: string },
    _params?: Params
  ): Promise<{ success: boolean }> {
    if (data.action === 'set_api_key' && data.api_key) {
      await this.authService.setApiKey({
        providerId: id,
        apiKey: data.api_key,
      });
      return { success: true };
    }

    throw new Error(`Unknown auth action: ${data.action}`);
  }

  /**
   * Remove provider auth (logout).
   * Query: ?action=logout
   */
  async remove(id: string, params?: Params): Promise<{ success: boolean }> {
    if (params?.query?.action === 'logout') {
      await this.authService.clearAuth(id);
      return { success: true };
    }

    throw new Error(`Unknown auth action: ${String(params?.query?.action)}`);
  }
}

/**
 * Create Pi Auth Service instance.
 */
export function createPiAuthService(db: Database): PiAuthService {
  return new PiAuthService(db);
}
