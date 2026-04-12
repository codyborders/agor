// src/package-service.ts

/**
 * PiPackageService - manages Pi packages (extensions, skills, themes).
 */

import { DefaultPackageManager, SettingsManager } from '@mariozechner/pi-coding-agent';
import { getPiEnvironmentManager } from './environment-manager.js';
import type { PiInstalledPackage } from './types.js';

export type PackageKind = 'extension' | 'skill' | 'theme' | 'prompt-template';
export type PackageScope = 'global' | 'project';

/**
 * Install a new package.
 */
export interface InstallPackageOptions {
  /** Package source (npm package name, git URL, or local path) */
  source: string;

  /** Installation scope */
  scope: PackageScope;

  /** Worktree path (required for project scope) */
  worktreePath?: string;

  /** Whether to persist in config (vs runtime-only) */
  persist?: boolean;
}

/**
 * Update an existing package.
 */
export interface UpdatePackageOptions {
  /** Package ID */
  packageId: string;

  /** Installation scope */
  scope: PackageScope;

  /** Worktree path (required for project scope) */
  worktreePath?: string;
}

export class PiPackageService {
  private envManager = getPiEnvironmentManager();

  private requireWorktreePathForProjectScope(scope: PackageScope, worktreePath?: string): void {
    if (scope === 'project' && !worktreePath) {
      throw new Error('Project-scoped Pi package operations require a worktree path');
    }
  }

  private async createPackageManager(worktreePath?: string): Promise<DefaultPackageManager> {
    const paths = await this.envManager.getPaths(worktreePath);
    const effectiveWorktreePath = worktreePath ?? process.cwd();
    const settingsManager = SettingsManager.create(effectiveWorktreePath, paths.globalConfigPath);

    return new DefaultPackageManager({
      cwd: effectiveWorktreePath,
      agentDir: paths.globalConfigPath,
      settingsManager,
    });
  }

  private inferPackageKind(packageSource: string): PackageKind {
    if (packageSource.includes('theme')) {
      return 'theme';
    }
    if (packageSource.includes('prompt')) {
      return 'prompt-template';
    }
    if (packageSource.includes('skill')) {
      return 'skill';
    }
    return 'extension';
  }

  private toInstalledPackage(
    packageSource: string,
    scope: PackageScope,
    installedPath?: string
  ): PiInstalledPackage {
    return {
      id: packageSource,
      name: packageSource,
      version: installedPath ? 'installed' : 'configured',
      kind: this.inferPackageKind(packageSource),
      enabled: true,
      scope,
      provides: installedPath ? [installedPath] : undefined,
    };
  }

  /**
   * List installed packages.
   */
  async listPackages(options: {
    scope?: PackageScope;
    worktreePath?: string;
    kind?: PackageKind;
  }): Promise<PiInstalledPackage[]> {
    if (options.scope === 'project' && !options.worktreePath) {
      throw new Error('Project-scoped Pi package queries require a worktree path');
    }

    const packageManager = await this.createPackageManager(options.worktreePath);
    const configuredPackages = packageManager.listConfiguredPackages();

    return configuredPackages
      .map((configuredPackage) => {
        const scope = configuredPackage.scope === 'project' ? 'project' : 'global';
        return this.toInstalledPackage(
          configuredPackage.source,
          scope,
          configuredPackage.installedPath
        );
      })
      .filter((installedPackage) => {
        if (options.scope && installedPackage.scope !== options.scope) {
          return false;
        }
        if (options.kind && installedPackage.kind !== options.kind) {
          return false;
        }
        return true;
      });
  }

  /**
   * Install a package.
   */
  async installPackage(options: InstallPackageOptions): Promise<PiInstalledPackage> {
    this.requireWorktreePathForProjectScope(options.scope, options.worktreePath);
    const packageManager = await this.createPackageManager(options.worktreePath);
    const installOptions = { local: options.scope === 'project' };

    if (options.persist === false) {
      await packageManager.install(options.source, installOptions);
    } else {
      await packageManager.installAndPersist(options.source, installOptions);
    }

    return this.toInstalledPackage(options.source, options.scope, options.source);
  }

  /**
   * Update an installed package.
   */
  async updatePackage(options: UpdatePackageOptions): Promise<PiInstalledPackage> {
    this.requireWorktreePathForProjectScope(options.scope, options.worktreePath);
    const packageManager = await this.createPackageManager(options.worktreePath);
    await packageManager.update(options.packageId);
    return this.toInstalledPackage(options.packageId, options.scope, options.packageId);
  }

  /**
   * Enable a package.
   */
  async enablePackage(
    packageId: string,
    scope: PackageScope,
    worktreePath?: string
  ): Promise<void> {
    this.requireWorktreePathForProjectScope(scope, worktreePath);
    const packageManager = await this.createPackageManager(worktreePath);
    packageManager.addSourceToSettings(packageId, { local: scope === 'project' });
  }

  /**
   * Disable a package.
   */
  async disablePackage(
    packageId: string,
    scope: PackageScope,
    worktreePath?: string
  ): Promise<void> {
    this.requireWorktreePathForProjectScope(scope, worktreePath);
    const packageManager = await this.createPackageManager(worktreePath);
    packageManager.removeSourceFromSettings(packageId, { local: scope === 'project' });
  }

  /**
   * Remove a package.
   */
  async removePackage(
    packageId: string,
    scope: PackageScope,
    worktreePath?: string
  ): Promise<void> {
    this.requireWorktreePathForProjectScope(scope, worktreePath);
    const packageManager = await this.createPackageManager(worktreePath);
    await packageManager.removeAndPersist(packageId, { local: scope === 'project' });
  }
}

let packageServiceInstance: PiPackageService | null = null;

export function getPiPackageService(): PiPackageService {
  if (!packageServiceInstance) {
    packageServiceInstance = new PiPackageService();
  }
  return packageServiceInstance;
}
