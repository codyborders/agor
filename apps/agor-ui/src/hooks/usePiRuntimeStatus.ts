/**
 * Hook for loading the Pi runtime status (model registry + auth state).
 *
 * Used by the Pi session config forms to populate Provider/Model dropdowns
 * with everything in Pi's model registry (built-in + custom). Reads the
 * daemon's pi-runtime service via the globally-registered AgorClient so
 * deep-tree components don't need to thread a client prop.
 *
 * Refresh the result with the returned `refresh()` — e.g. after the user
 * edits Pi providers in settings and returns to a session form.
 */

import type { AgorClient } from '@agor/core/api';
import type { PiRuntimeStatus } from '@agor/core/types';
import { useCallback, useEffect, useState } from 'react';

function getGlobalClient(): AgorClient | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as unknown as { __agorClient?: AgorClient | null }).__agorClient ?? null
  );
}

export interface UsePiRuntimeStatusResult {
  status: PiRuntimeStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePiRuntimeStatus(): UsePiRuntimeStatusResult {
  const [status, setStatus] = useState<PiRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const client = getGlobalClient();
    if (!client) {
      // Client not ready yet — don't error; the hook will retry when the
      // caller triggers refresh() again (usually on mount or user action).
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // pi-runtime service exposes a single find() returning the status for
      // the global (or optional worktree-scoped) Pi environment.
      const next = (await client.service('pi-runtime').find({})) as PiRuntimeStatus;
      setStatus(next);
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to load Pi runtime status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, loading, error, refresh };
}
