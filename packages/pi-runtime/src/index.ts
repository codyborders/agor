// src/index.ts

/**
 * @agor/pi-runtime - Pi Agent SDK integration for Agor
 *
 * Provides:
 * - PiEnvironmentManager: Path resolution and caching
 * - PiSessionService: Native Pi session management
 * - PiCatalogService: Models, commands, themes catalog
 * - PiPackageService: Package management
 * - PiAuthService: Authentication provider management
 */

export type {
  ApiKeyOptions,
  AuthAction,
  ProviderLoginOptions,
} from './auth-service.js';
// Auth Service
export { getPiAuthService, PiAuthService } from './auth-service.js';
// Catalog Service
export { getPiCatalogService, PiCatalogService } from './catalog-service.js';

// Environment Manager
export { getPiEnvironmentManager, PiEnvironmentManager } from './environment-manager.js';
export type {
  InstallPackageOptions,
  PackageKind,
  PackageScope,
  UpdatePackageOptions,
} from './package-service.js';

// Package Service
export { getPiPackageService, PiPackageService } from './package-service.js';
// Session Service
export { getPiSessionService, PiSessionService } from './session-service.js';
// Re-export types for consumers
export type {
  CompactionEvent,
  CreateSessionOptions,
  ForkSessionOptions,
  PiCompletionResult,
  PiPaths,
  PiStreamingCallbacks,
  ResumeSessionOptions,
} from './types.js';
