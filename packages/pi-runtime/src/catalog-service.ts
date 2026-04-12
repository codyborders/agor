// src/catalog-service.ts

/**
 * PiCatalogService - provides access to Pi's catalog (models, commands, themes).
 */

import * as path from 'node:path';
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SettingsManager,
} from '@mariozechner/pi-coding-agent';
import { getPiEnvironmentManager } from './environment-manager.js';
import type { PiCommandCatalogItem } from './types.js';

export class PiCatalogService {
  private envManager = getPiEnvironmentManager();

  private async buildResourceLoader(worktreePath?: string): Promise<DefaultResourceLoader> {
    const paths = await this.envManager.getPaths(worktreePath);
    const settingsManager = SettingsManager.create(worktreePath, paths.globalConfigPath);
    const loader = new DefaultResourceLoader({
      cwd: worktreePath ?? process.cwd(),
      agentDir: paths.globalConfigPath,
      settingsManager,
    });
    await loader.reload();
    return loader;
  }

  /**
   * Get available models from Pi.
   */
  async getModels(worktreePath?: string): Promise<string[]> {
    const paths = await this.envManager.getPaths(worktreePath);
    const authStorage = AuthStorage.create(path.join(paths.globalConfigPath, 'auth.json'));
    const modelRegistry = ModelRegistry.create(
      authStorage,
      path.join(paths.globalConfigPath, 'models.json')
    );
    return modelRegistry.getAll().map((model) => model.id);
  }

  /**
   * Get available slash commands.
   */
  async getSlashCommands(worktreePath?: string): Promise<PiCommandCatalogItem[]> {
    const loader = await this.buildResourceLoader(worktreePath);
    return loader.getExtensions().extensions.flatMap((extension) =>
      Array.from(extension.commands.values()).map((command) => ({
        name: `/${command.name}`,
        description: command.description,
        source: extension.path,
        is_slash_command: true,
      }))
    );
  }

  /**
   * Get extension commands from installed packages.
   */
  async getExtensionCommands(worktreePath?: string): Promise<PiCommandCatalogItem[]> {
    return this.getSlashCommands(worktreePath);
  }

  /**
   * Get prompt templates.
   */
  async getPromptTemplates(
    worktreePath?: string
  ): Promise<Array<{ name: string; description: string }>> {
    const loader = await this.buildResourceLoader(worktreePath);
    return loader.getPrompts().prompts.map((promptTemplate) => ({
      name: promptTemplate.name,
      description: promptTemplate.description || '',
    }));
  }

  /**
   * Get available themes.
   */
  async getThemes(worktreePath?: string): Promise<string[]> {
    const loader = await this.buildResourceLoader(worktreePath);
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
  }

  /**
   * Get available skills from packages.
   */
  async getSkills(worktreePath?: string): Promise<Array<{ name: string; description: string }>> {
    const loader = await this.buildResourceLoader(worktreePath);
    return loader.getSkills().skills.map((skill) => ({
      name: skill.name,
      description: skill.description || '',
    }));
  }
}

let catalogServiceInstance: PiCatalogService | null = null;

export function getPiCatalogService(): PiCatalogService {
  if (!catalogServiceInstance) {
    catalogServiceInstance = new PiCatalogService();
  }
  return catalogServiceInstance;
}
