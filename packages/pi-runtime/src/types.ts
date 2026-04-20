// src/types.ts

/**
 * Internal + shared types for pi-runtime.
 *
 * Shared types (wire contract between daemon, core, and UI) are imported from
 * @agor/core/types/pi — they are the single source of truth. Anything defined
 * directly in this file is pi-runtime-internal state (paths, streaming
 * callbacks, session-option builders) that consumers outside the daemon do not
 * see.
 */

export type {
  PiAuthProviderStatus,
  PiCommandCatalogItem,
  PiFileDocument,
  PiInstalledPackage,
  PiNativeBinding,
  PiNativeBranch,
  PiNativeSessionSummary,
  PiNativeSessionTree,
  PiProviderModelPair,
  PiRuntimeStatus,
  PiToolOptions,
} from '@agor/core/types';

// ============================================================================
// Internal Types (not part of the wire contract)
// ============================================================================

/**
 * Path configuration for Pi runtime.
 */
export interface PiPaths {
  globalConfigPath: string;
  projectConfigPath?: string;
  globalSessionsPath: string;
  projectSessionsPath?: string;
}

/**
 * Session creation options.
 */
export interface CreateSessionOptions {
  worktreePath?: string;
  branchLabel?: string;
  toolOptions?: import('@agor/core/types').PiToolOptions;
  parentSessionId?: string;
}

/**
 * Session resume options.
 */
export interface ResumeSessionOptions {
  rootSessionId: string;
  branchId: string;
  worktreePath?: string;
}

/**
 * Fork options.
 */
export interface ForkSessionOptions {
  parentRootSessionId: string;
  sourceBranchId: string;
  newBranchLabel?: string;
  worktreePath?: string;
}

/**
 * Compaction event.
 */
export interface CompactionEvent {
  type: 'compaction' | 'compaction_start' | 'compaction_end';
  tokensPreserved?: number;
  timestamp: string;
}

/**
 * Streaming callbacks.
 */
export interface PiStreamingCallbacks {
  onAssistantChunk?: (chunk: string) => void;
  onToolCallStart?: (toolName: string, toolInput: unknown) => void;
  onToolCallEnd?: (toolName: string, toolOutput: unknown) => void;
  onToolCallError?: (toolName: string, error: string) => void;
  onCompaction?: (event: CompactionEvent) => void;
  onComplete?: (result: PiCompletionResult) => void;
  onError?: (error: Error) => void;
}

/**
 * Completion result.
 */
export interface PiCompletionResult {
  message: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  cost?: {
    total: number;
    currency: string;
  };
  wasStopped?: boolean;
  rawResponse?: unknown;
}
