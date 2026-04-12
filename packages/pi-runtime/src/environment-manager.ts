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
import type { PiPaths, PiRuntimeStatus } from './types.js';

export class PiEnvironmentManager {
  private paths: PiPaths | null = null;
  private statusCache: PiRuntimeStatus | null = null;
  private cacheInvalidated = false;

  /**
   * Get or compute Pi paths for the given worktree.
   */
  async getPaths(worktreePath?: string): Promise<PiPaths> {
    if (this.paths) {
      return this.paths;
    }

    const homeDir = os.homedir();
    const globalConfigPath = path.join(homeDir, '.pi', 'agent');
    const globalSessionsPath = path.join(globalConfigPath, 'sessions');

    const paths: PiPaths = {
      globalConfigPath,
      globalSessionsPath,
    };

    if (worktreePath) {
      const projectConfigPath = path.join(worktreePath, '.pi');
      const projectSessionsPath = path.join(projectConfigPath, 'sessions');

      // Check if project-level Pi exists
      try {
        await fs.access(projectConfigPath);
        paths.projectConfigPath = projectConfigPath;
        paths.projectSessionsPath = projectSessionsPath;
      } catch {
        // Project-level Pi doesn't exist yet
      }
    }

    this.paths = paths;
    return paths;
  }

  /**
   * Get Pi runtime status.
   */
  async getStatus(worktreePath?: string): Promise<PiRuntimeStatus> {
    if (this.statusCache && !this.cacheInvalidated) {
      return this.statusCache;
    }

    const paths = await this.getPaths(worktreePath);

    const status: PiRuntimeStatus = {
      available: await this.checkAvailability(),
      global_config_path: paths.globalConfigPath,
      project_config_path: paths.projectConfigPath,
      version: await this.getVersion(paths.globalConfigPath),
      model_suggestions: await this.getModelSuggestions(paths),
      command_catalog: await this.getCommandCatalog(paths),
      themes: await this.getThemes(paths),
    };

    this.statusCache = status;
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
   * Get model suggestions from Pi config.
   */
  private async getModelSuggestions(paths: PiPaths): Promise<string[] | undefined> {
    try {
      const authStorage = AuthStorage.create(path.join(paths.globalConfigPath, 'auth.json'));
      const modelRegistry = ModelRegistry.create(
        authStorage,
        path.join(paths.globalConfigPath, 'models.json')
      );
      return modelRegistry.getAll().map((model) => model.id);
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
    this.paths = null;
    this.statusCache = null;
    this.cacheInvalidated = true;
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
