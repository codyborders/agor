// src/types.ts

/**
 * Internal types for pi-runtime package.
 *
 * These types mirror @agor/core/types for Pi-specific types.
 * In the future, these could be consolidated if @agor/core is restructured.
 */

// ============================================================================
// Pi Tool Options
// ============================================================================

/**
 * Tool options specific to Pi sessions.
 */
export interface PiToolOptions {
  reasoning_effort?: string;
  compaction_mode?: 'inherit' | 'off' | 'auto' | 'manual';
  compaction_threshold_tokens?: number;
  raw_overrides?: Record<string, unknown>;
}

// ============================================================================
// Pi Native Binding
// ============================================================================

/**
 * Native Pi session binding.
 */
export interface PiNativeBinding {
  root_session_id: string;
  branch_id: string;
  session_file_path: string;
  branch_label?: string;
  imported: boolean;
  last_synced_at?: string;
}

// ============================================================================
// Pi Runtime Status
// ============================================================================

/**
 * Pi command catalog item.
 */
export interface PiCommandCatalogItem {
  name: string;
  description?: string;
  source: string;
  is_slash_command: boolean;
}

/**
 * Installed Pi package.
 */
export interface PiInstalledPackage {
  id: string;
  name: string;
  version: string;
  kind: string;
  enabled: boolean;
  scope: 'global' | 'project';
  provides?: string[];
}

/**
 * Auth provider status.
 */
export interface PiAuthProviderStatus {
  provider_id: string;
  name: string;
  auth_type: 'api_key' | 'oauth' | 'subscription';
  configured: boolean;
  status_message?: string;
}

/**
 * Native Pi session summary.
 */
export interface PiNativeSessionSummary {
  root_session_id: string;
  session_file_path: string;
  current_branch_id: string;
  current_branch_label?: string;
  last_modified: string;
  branch_count: number;
}

/**
 * Native branch.
 */
export interface PiNativeBranch {
  branch_id: string;
  parent_branch_id?: string;
  label?: string;
  created_at: string;
  last_modified: string;
}

/**
 * Native Pi session tree.
 */
export interface PiNativeSessionTree {
  summary: PiNativeSessionSummary;
  branches: PiNativeBranch[];
  active_branch_id: string;
}

/**
 * Pi file document.
 */
export interface PiFileDocument {
  id: string;
  data?: Record<string, unknown>;
  raw?: string;
  parsed: boolean;
  parse_error?: string;
  file_path: string;
  last_modified: string;
}

/**
 * A provider/model pair from the Pi model registry, exposed for UI pickers.
 */
export interface PiProviderModelPair {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  context_window: number;
  input: Array<'text' | 'image'>;
  has_configured_auth: boolean;
}

/**
 * Pi runtime status.
 */
export interface PiRuntimeStatus {
  available: boolean;
  global_config_path: string;
  project_config_path?: string;
  version?: string;
  model_suggestions?: string[];
  provider_model_pairs?: PiProviderModelPair[];
  command_catalog?: PiCommandCatalogItem[];
  themes?: string[];
}

// ============================================================================
// Internal Types
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
  toolOptions?: PiToolOptions;
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
