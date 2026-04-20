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
import type { PiPaths, PiProviderModelPair, PiRuntimeStatus } from './types.js';

export class PiEnvironmentManager {
  private pathsByScope = new Map<string, PiPaths>();
  private statusByScope = new Map<string, PiRuntimeStatus>();

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
        // Project-level Pi doesn't exist yet
      }
    }

    this.pathsByScope.set(scopeKey, paths);
    return paths;
  }

  /**
   * Get Pi runtime status.
   */
  async getStatus(worktreePath?: string): Promise<PiRuntimeStatus> {
    const scopeKey = this.getScopeKey(worktreePath);
    const cachedStatus = this.statusByScope.get(scopeKey);
    if (cachedStatus) {
      return cachedStatus;
    }

    const paths = await this.getPaths(worktreePath);

    const providerModelPairs = await this.getProviderModelPairs(paths);
    const status: PiRuntimeStatus = {
      available: await this.checkAvailability(),
      global_config_path: paths.globalConfigPath,
      project_config_path: paths.projectConfigPath,
      version: await this.getVersion(paths.globalConfigPath),
      model_suggestions: providerModelPairs?.map((pair) => pair.id),
      provider_model_pairs: providerModelPairs,
      command_catalog: await this.getCommandCatalog(paths),
      themes: await this.getThemes(paths),
    };

    this.statusByScope.set(scopeKey, status);
    return status;
  }

  /**
   * Check if Pi SDK is available.
   */
  private async checkAvailability(): Promise<boolean> {
    try {
      const pi = await import('@mariozechner/pi-coding-agent');
      return pi !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get installed Pi version.
   */
  private async getVersion(globalConfigPath: string): Promise<string | undefined> {
    try {
      const packageJsonPath = path.join(globalConfigPath, '..', 'package.json');
      const packageJson = await fs.readFile(packageJsonPath, 'utf-8');
      const { version } = JSON.parse(packageJson);
      return version;
    } catch {
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
    } catch {
      return undefined;
    }
  }

  /**
   * Get available commands from Pi.
   */
  private async getCommandCatalog(
    paths: PiPaths
  ): Promise<PiRuntimeStatus['command_catalog'] | undefined> {
    try {
      const settingsManager = SettingsManager.create(undefined, paths.globalConfigPath);
      const loader = new DefaultResourceLoader({
        agentDir: paths.globalConfigPath,
        settingsManager,
      });
      await loader.reload();
      return loader.getExtensions().extensions.flatMap((extension) =>
        Array.from(extension.commands.values()).map((command) => ({
          name: `/${command.name}`,
          description: command.description,
          source: extension.path,
          is_slash_command: true,
        }))
      );
    } catch {
      return [];
    }
  }

  /**
   * Get available themes.
   */
  private async getThemes(paths: PiPaths): Promise<string[] | undefined> {
    try {
      const settingsManager = SettingsManager.create(undefined, paths.globalConfigPath);
      const loader = new DefaultResourceLoader({
        agentDir: paths.globalConfigPath,
        settingsManager,
      });
      await loader.reload();
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
    } catch {
      return [];
    }
  }

  /**
   * Invalidate cached values.
   */
  invalidateCache(): void {
    this.pathsByScope.clear();
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
        // Fall through to global
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
