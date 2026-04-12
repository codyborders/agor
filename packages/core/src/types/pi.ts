// src/types/pi.ts

/**
 * Pi Agent-specific types for Agor integration.
 *
 * These types handle:
 * - Session-level tool options for Pi sessions
 * - Native Pi session binding (linking Agor sessions to native Pi sessions)
 * - Pi runtime status and catalog types
 * - Pi package/auth management types
 */

/**
 * Tool options specific to Pi sessions.
 *
 * These are session-level overrides that affect Pi's runtime behavior.
 */
export interface PiToolOptions {
  /**
   * Reasoning effort level for Pi sessions.
   * Maps to Pi's native reasoning effort setting.
   */
  reasoning_effort?: string;

  /**
   * Compaction mode controls how Pi handles context window pressure.
   * - inherit: Use worktree/project settings (default)
   * - off: Disable compaction
   * - auto: Enable automatic compaction
   * - manual: User-controlled compaction via explicit command
   */
  compaction_mode?: 'inherit' | 'off' | 'auto' | 'manual';

  /**
   * Token threshold that triggers compaction when compaction_mode is 'auto'.
   * Default is Pi's internal default.
   */
  compaction_threshold_tokens?: number;

  /**
   * Raw per-session override JSON passed directly to Pi.
   * Use for experimental or Pi-internal settings not yet typed here.
   */
  raw_overrides?: Record<string, unknown>;
}

/**
 * Native Pi session binding.
 *
 * Links an Agor Session to a native Pi root session and branch.
 * The native Pi state lives in:
 * - Global: ~/.pi/agent
 * - Project: <worktree>/.pi/
 */
export interface PiNativeBinding {
  /** Native Pi root session ID */
  root_session_id: string;

  /** Branch ID within the native Pi root session */
  branch_id: string;

  /** Absolute path to the native Pi session file */
  session_file_path: string;

  /** Optional human-readable branch label */
  branch_label?: string;

  /** Whether this session was imported from native Pi (vs created in Agor) */
  imported: boolean;

  /** ISO timestamp of last sync with native Pi state */
  last_synced_at?: string;
}

// ============================================================================
// Pi Runtime Types (for daemon services)
// ============================================================================

/**
 * Pi runtime status returned by pi-runtime service.
 */
export interface PiRuntimeStatus {
  /** Whether Pi SDK is available/installed */
  available: boolean;

  /** Path to global Pi config (~/.pi/agent) */
  global_config_path: string;

  /** Path to project-level Pi config (worktree/.pi/) */
  project_config_path?: string;

  /** Installed Pi version, if available */
  version?: string;

  /** List of discovered model suggestions */
  model_suggestions?: string[];

  /** Available slash commands from Pi and installed packages */
  command_catalog?: PiCommandCatalogItem[];

  /** Available themes from Pi and installed packages */
  themes?: string[];
}

/**
 * A command item from Pi's catalog (slash commands, extension commands, etc.)
 */
export interface PiCommandCatalogItem {
  /** Command name (e.g., '/my-command' or 'extension:my-command') */
  name: string;

  /** Human-readable description */
  description?: string;

  /** Source of the command: 'pi' (built-in) or package name */
  source: string;

  /** Whether this is a slash command (starts with /) */
  is_slash_command: boolean;
}

/**
 * An installed Pi package (extension, skill, theme, etc.)
 */
export interface PiInstalledPackage {
  /** Unique package identifier */
  id: string;

  /** Package name */
  name: string;

  /** Package version */
  version: string;

  /** Package kind: 'extension' | 'skill' | 'theme' | 'prompt-template' */
  kind: string;

  /** Whether the package is currently enabled */
  enabled: boolean;

  /** Installation scope: 'global' (~/.pi) or 'project' (<worktree>/.pi) */
  scope: 'global' | 'project';

  /** Resources provided by this package (commands, themes, etc.) */
  provides?: string[];
}

/**
 * Auth provider status for Pi.
 */
export interface PiAuthProviderStatus {
  /** Provider ID (e.g., 'openai', 'anthropic') */
  provider_id: string;

  /** Provider display name */
  name: string;

  /** Auth type: 'api_key' | 'oauth' | 'subscription' */
  auth_type: 'api_key' | 'oauth' | 'subscription';

  /** Whether this provider is currently configured/connected */
  configured: boolean;

  /** Optional status message (e.g., 'Token expires in 30 days') */
  status_message?: string;
}

/**
 * Summary of a native Pi root session for listing.
 */
export interface PiNativeSessionSummary {
  /** Native Pi root session ID */
  root_session_id: string;

  /** Path to the session file */
  session_file_path: string;

  /** Most recent branch ID */
  current_branch_id: string;

  /** Human-readable branch label (if set) */
  current_branch_label?: string;

  /** ISO timestamp of last modification */
  last_modified: string;

  /** Number of branches in this root session */
  branch_count: number;
}

/**
 * A branch within a native Pi session tree.
 */
export interface PiNativeBranch {
  /** Branch ID */
  branch_id: string;

  /** Parent branch ID (null for root) */
  parent_branch_id?: string;

  /** Human-readable label */
  label?: string;

  /** ISO timestamp of creation */
  created_at: string;

  /** ISO timestamp of last modification */
  last_modified: string;
}

/**
 * Full native Pi session tree structure.
 */
export interface PiNativeSessionTree {
  /** Root session metadata */
  summary: PiNativeSessionSummary;

  /** All branches in the session (flat list) */
  branches: PiNativeBranch[];

  /** ID of the currently active/HEAD branch */
  active_branch_id: string;
}

/**
 * A document (config file) accessible via pi-files service.
 */
export interface PiFileDocument {
  /** Document ID: 'global-settings' | 'project-settings' | 'models' */
  id: string;

  /** Document content as structured object (if parsed successfully) */
  data?: Record<string, unknown>;

  /** Raw document content (if parsing failed or for raw editing) */
  raw?: string;

  /** Whether the document was parsed successfully */
  parsed: boolean;

  /** Error message if parsing failed */
  parse_error?: string;

  /** Path to the source file */
  file_path: string;

  /** Last modified timestamp */
  last_modified: string;
}
