// src/environment-manager.ts

/**
 * PiEnvironmentManager - manages path resolution and caching for Pi runtime.
 *
 * Handles resolution of:
 * - Global Pi paths (~/.pi/agent)
 * - Project-level Pi paths (<worktree>/.pi/)
 * - Caching of settings, auth, and model information
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SettingsManager,
} from '@mariozechner/pi-coding-agent';
import type {
  PiCommandCatalogItem,
  PiPaths,
  PiProviderModelPair,
  PiRuntimeStatus,
} from './types.js';

/**
 * Status cache entry with expiry timestamp. A short TTL prevents a long-lived
 * daemon from serving years-old registry data, while still avoiding a cold
 * recomputation on every UI open.
 */
interface CachedStatus {
  status: PiRuntimeStatus;
  expires_at_ms: number;
}

/** Status cache lifetime in milliseconds. Intentionally short. */
const STATUS_CACHE_TTL_MS = 15_000;

function logWarn(scope: string, error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  // Keep structured so logs are grepable; avoid leaking any apiKey values —
  // pi-ai errors do not embed auth material, and we deliberately don't include
  // raw stacks in the line.
  console.warn(`[pi-runtime] ${scope} failed: ${detail}`);
}

export class PiEnvironmentManager {
  private pathsByScope = new Map<string, PiPaths>();
  private statusByScope = new Map<string, CachedStatus>();

  private getScopeKey(worktreePath?: string): string {
    if (!worktreePath) {
      return '__global__';
    }

    return path.resolve(worktreePath);
  }

  private getEffectiveCwd(worktreePath?: string): string {
    return path.resolve(worktreePath ?? process.cwd());
  }

  private expandConfiguredPath(configuredPath: string, cwd: string): string {
    if (configuredPath.startsWith('~/')) {
      return path.join(os.homedir(), configuredPath.slice(2));
    }

    if (configuredPath === '~') {
      return os.homedir();
    }

    if (path.isAbsolute(configuredPath)) {
      return configuredPath;
    }

    return path.resolve(cwd, configuredPath);
  }

  private getDefaultSessionDir(cwd: string, globalConfigPath: string): string {
    const safePath = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
    return path.join(globalConfigPath, 'sessions', safePath);
  }

  async resolveSessionDir(worktreePath?: string): Promise<string> {
    const cwd = this.getEffectiveCwd(worktreePath);
    const globalConfigPath = path.join(os.homedir(), '.pi', 'agent');
    const settingsManager = SettingsManager.create(cwd, globalConfigPath);
    const configuredSessionDir = settingsManager.getSessionDir();

    if (configuredSessionDir && configuredSessionDir.trim() !== '') {
      return this.expandConfiguredPath(configuredSessionDir, cwd);
    }

    return this.getDefaultSessionDir(cwd, globalConfigPath);
  }

  /**
   * Get or compute Pi paths for the given worktree.
   */
  async getPaths(worktreePath?: string): Promise<PiPaths> {
    const scopeKey = this.getScopeKey(worktreePath);
    const cachedPaths = this.pathsByScope.get(scopeKey);
    if (cachedPaths) {
      return cachedPaths;
    }

    const homeDir = os.homedir();
    const globalConfigPath = path.join(homeDir, '.pi', 'agent');
    const cwd = this.getEffectiveCwd(worktreePath);
    const settingsManager = SettingsManager.create(cwd, globalConfigPath);
    const globalSessionsPath = await this.resolveSessionDir(worktreePath);

    const paths: PiPaths = {
      globalConfigPath,
      globalSessionsPath,
    };

    if (worktreePath) {
      const projectConfigPath = path.join(cwd, '.pi');
      const projectSessionDir = settingsManager.getProjectSettings().sessionDir;

      // Check if project-level Pi exists
      try {
        await fs.access(projectConfigPath);
        paths.projectConfigPath = projectConfigPath;
        if (projectSessionDir && projectSessionDir.trim() !== '') {
          paths.projectSessionsPath = this.expandConfiguredPath(projectSessionDir, cwd);
        }
      } catch {
        // Project-level Pi doesn't exist yet — expected when the project has
        // no .pi directory; stays silent.
      }
    }

    this.pathsByScope.set(scopeKey, paths);
    return paths;
  }

  /**
   * Get Pi runtime status. Cache entries honor STATUS_CACHE_TTL_MS to avoid
   * serving multi-minute-stale registry data after a user writes to
   * auth.json or models.json. The pi-auth and pi-files daemon services also
   * call invalidateStatus() on write so users see changes immediately.
   */
  async getStatus(worktreePath?: string): Promise<PiRuntimeStatus> {
    const scopeKey = this.getScopeKey(worktreePath);
    const cachedStatus = this.statusByScope.get(scopeKey);
    if (cachedStatus && cachedStatus.expires_at_ms > Date.now()) {
      return cachedStatus.status;
    }

    const paths = await this.getPaths(worktreePath);

    // Independent lookups run in parallel. Each inner helper already catches
    // and logs its own errors, so Promise.all resolves even if individual
    // probes fail (returning undefined/[] in place of the failed value).
    const [available, version, providerModelPairs, commandCatalog, themes] = await Promise.all([
      this.checkAvailability(),
      this.getVersion(paths.globalConfigPath),
      this.getProviderModelPairs(paths),
      this.getCommandCatalog(paths),
      this.getThemes(paths),
    ]);

    const status: PiRuntimeStatus = {
      available,
      global_config_path: paths.globalConfigPath,
      project_config_path: paths.projectConfigPath,
      version,
      model_suggestions: providerModelPairs?.map((pair) => pair.id),
      provider_model_pairs: providerModelPairs,
      command_catalog: commandCatalog,
      themes,
    };

    this.statusByScope.set(scopeKey, {
      status,
      expires_at_ms: Date.now() + STATUS_CACHE_TTL_MS,
    });
    return status;
  }

  /**
   * Check if Pi SDK is available.
   *
   * The pi-coding-agent module is already statically imported at the top of
   * this file, so import-time failures would have crashed the daemon. Return
   * true directly rather than re-importing on every status read.
   */
  private async checkAvailability(): Promise<boolean> {
    return true;
  }

  /**
   * Get installed Pi version.
   */
  private async getVersion(globalConfigPath: string): Promise<string | undefined> {
    try {
      const packageJsonPath = path.join(globalConfigPath, '..', 'package.json');
      const packageJson = await fs.readFile(packageJsonPath, 'utf-8');
      const { version } = JSON.parse(packageJson);
      return typeof version === 'string' ? version : undefined;
    } catch (error) {
      // ENOENT when Pi has never been initialized under ~/.pi; quiet.
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        logWarn('getVersion', error);
      }
      return undefined;
    }
  }

  /**
   * Get provider/model pairs from Pi's model registry.
   *
   * The pi-ai ModelRegistry unions built-in providers (anthropic, openai, google,
   * minimax, zai, etc.) with any custom providers defined in ~/.pi/agent/models.json.
   * Each entry is annotated with whether auth is configured so UI pickers can warn
   * the user before they pick a model they cannot run.
   */
  private async getProviderModelPairs(paths: PiPaths): Promise<PiProviderModelPair[] | undefined> {
    try {
      const authStorage = AuthStorage.create(path.join(paths.globalConfigPath, 'auth.json'));
      const modelRegistry = ModelRegistry.create(
        authStorage,
        path.join(paths.globalConfigPath, 'models.json')
      );
      const configuredProviders = new Set(authStorage.list());
      return modelRegistry.getAll().map((model) => ({
        provider: model.provider,
        id: model.id,
        name: model.name ?? model.id,
        reasoning: Boolean(model.reasoning),
        context_window: model.contextWindow ?? 0,
        input: Array.isArray(model.input)
          ? (model.input.filter((kind) => kind === 'text' || kind === 'image') as Array<
              'text' | 'image'
            >)
          : ['text'],
        has_configured_auth: configuredProviders.has(model.provider),
      }));
    } catch (error) {
      logWarn('getProviderModelPairs', error);
      return undefined;
    }
  }

  /**
   * Build a DefaultResourceLoader shared by getCommandCatalog and getThemes.
   * Each cold status recomputes this once per scope so we don't do the same
   * disk scan twice per call.
   */
  private async loadResources(paths: PiPaths): Promise<DefaultResourceLoader> {
    const settingsManager = SettingsManager.create(undefined, paths.globalConfigPath);
    const loader = new DefaultResourceLoader({
      agentDir: paths.globalConfigPath,
      settingsManager,
    });
    await loader.reload();
    return loader;
  }

  /**
   * Get available commands from Pi.
   */
  private async getCommandCatalog(paths: PiPaths): Promise<PiCommandCatalogItem[] | undefined> {
    try {
      const loader = await this.loadResources(paths);
      return loader.getExtensions().extensions.flatMap((extension) =>
        Array.from(extension.commands.values()).map((command) => ({
          name: `/${command.name}`,
          description: command.description,
          source: extension.path,
          is_slash_command: true,
        }))
      );
    } catch (error) {
      logWarn('getCommandCatalog', error);
      return [];
    }
  }

  /**
   * Get available themes.
   */
  private async getThemes(paths: PiPaths): Promise<string[] | undefined> {
    try {
      const loader = await this.loadResources(paths);
      return loader
        .getThemes()
        .themes.map((theme) => {
          if (
            theme &&
            typeof theme === 'object' &&
            'name' in theme &&
            typeof theme.name === 'string'
          ) {
            return theme.name;
          }
          return undefined;
        })
        .filter((themeName): themeName is string => Boolean(themeName));
    } catch (error) {
      logWarn('getThemes', error);
      return [];
    }
  }

  /**
   * Invalidate cached paths and status. Called by pi-auth / pi-files when the
   * user writes an API key or edits models.json, so the next getStatus() sees
   * the change immediately instead of waiting for the TTL.
   */
  invalidateCache(): void {
    this.pathsByScope.clear();
    this.statusByScope.clear();
  }

  /**
   * Invalidate only the status cache. Cheaper than invalidateCache() when the
   * mutation could not possibly have changed filesystem paths (e.g., an auth
   * key write leaves paths stable).
   */
  invalidateStatus(): void {
    this.statusByScope.clear();
  }

  /**
   * Resolve the effective path for a setting (project vs global).
   */
  async resolveConfigPath(
    configType: 'settings' | 'models' | 'auth',
    worktreePath?: string
  ): Promise<string> {
    const paths = await this.getPaths(worktreePath);

    if (worktreePath && paths.projectConfigPath) {
      const projectConfigPath = path.join(paths.projectConfigPath, `${configType}.json`);
      try {
        await fs.access(projectConfigPath);
        return projectConfigPath;
      } catch {
        // Fall through to global — project-level file just doesn't exist.
      }
    }

    // Global path
    return path.join(paths.globalConfigPath, `${configType}.json`);
  }
}

// Singleton instance for process lifetime
let environmentManagerInstance: PiEnvironmentManager | null = null;

export function getPiEnvironmentManager(): PiEnvironmentManager {
  if (!environmentManagerInstance) {
    environmentManagerInstance = new PiEnvironmentManager();
  }
  return environmentManagerInstance;
}
