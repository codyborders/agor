// src/auth-service.ts

/**
 * PiAuthService - manages Pi authentication providers.
 */

import * as path from 'node:path';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { getPiEnvironmentManager } from './environment-manager.js';
import type { PiAuthProviderStatus } from './types.js';

export type AuthAction = 'login' | 'logout' | 'set_api_key' | 'clear_api_key';

export interface ProviderLoginOptions {
  /** Provider ID */
  providerId: string;

  /** Worktree path (for project-scoped auth) */
  worktreePath?: string;

  /** OAuth callback port (for local OAuth flows) */
  callbackPort?: number;
}

export interface ApiKeyOptions {
  /** Provider ID */
  providerId: string;

  /** API key to store */
  apiKey: string;

  /** Worktree path (for project-scoped auth) */
  worktreePath?: string;
}

export class PiAuthService {
  private envManager = getPiEnvironmentManager();

  private async createAuthStorage(worktreePath?: string): Promise<AuthStorage> {
    const paths = await this.envManager.getPaths(worktreePath);
    return AuthStorage.create(path.join(paths.globalConfigPath, 'auth.json'));
  }

  private async listKnownProviders(worktreePath?: string): Promise<string[]> {
    const paths = await this.envManager.getPaths(worktreePath);
    const authStorage = await this.createAuthStorage(worktreePath);
    const modelRegistry = ModelRegistry.create(
      authStorage,
      path.join(paths.globalConfigPath, 'models.json')
    );
    const providers = new Set<string>();

    for (const model of modelRegistry.getAll()) {
      providers.add(model.provider);
    }
    for (const provider of authStorage.list()) {
      providers.add(provider);
    }

    return Array.from(providers).sort();
  }

  /**
   * List auth providers and their status.
   */
  async listProviders(worktreePath?: string): Promise<PiAuthProviderStatus[]> {
    const authStorage = await this.createAuthStorage(worktreePath);
    const oauthProviders = new Set(authStorage.getOAuthProviders().map((provider) => provider.id));
    const providers = await this.listKnownProviders(worktreePath);

    return providers.map((providerId) => ({
      provider_id: providerId,
      name: providerId
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
      auth_type: oauthProviders.has(providerId) ? 'oauth' : 'api_key',
      configured: authStorage.hasAuth(providerId),
      status_message: authStorage.hasAuth(providerId) ? 'Configured' : undefined,
    }));
  }

  /**
   * Start OAuth login flow for a provider.
   * Returns a state machine token for UI-driven OAuth.
   */
  async startLogin(
    options: ProviderLoginOptions
  ): Promise<{ stateMachineToken: string; authUrl: string }> {
    const authStorage = await this.createAuthStorage(options.worktreePath);
    const provider = authStorage
      .getOAuthProviders()
      .find((oauthProvider) => oauthProvider.id === options.providerId);

    if (!provider) {
      throw new Error(`Pi provider ${options.providerId} does not expose an OAuth login flow`);
    }

    throw new Error(
      `Interactive Pi OAuth login for ${provider.name} is not available through the daemon service yet`
    );
  }

  /**
   * Complete OAuth login (called by UI after OAuth callback).
   */
  async completeLogin(stateMachineToken: string): Promise<void> {
    console.log(`Completing OAuth login with token: ${stateMachineToken}`);
  }

  /**
   * Set API key for a provider.
   */
  async setApiKey(options: ApiKeyOptions): Promise<void> {
    const authStorage = await this.createAuthStorage(options.worktreePath);
    authStorage.set(options.providerId, {
      type: 'api_key',
      key: options.apiKey,
    });
  }

  /**
   * Clear auth for a provider (logout).
   */
  async clearAuth(providerId: string, worktreePath?: string): Promise<void> {
    const authStorage = await this.createAuthStorage(worktreePath);
    authStorage.remove(providerId);
  }

  /**
   * Get OAuth URL for a provider (for manual copy/paste flow).
   */
  async getOAuthUrl(providerId: string): Promise<string> {
    throw new Error(
      `Pi provider ${providerId} requires interactive OAuth login, which the daemon service does not currently broker`
    );
  }

  /**
   * Check if a provider is configured.
   */
  async isProviderConfigured(providerId: string): Promise<boolean> {
    const providers = await this.listProviders();
    const provider = providers.find((p) => p.provider_id === providerId);
    return provider?.configured ?? false;
  }
}

let authServiceInstance: PiAuthService | null = null;

export function getPiAuthService(): PiAuthService {
  if (!authServiceInstance) {
    authServiceInstance = new PiAuthService();
  }
  return authServiceInstance;
}
