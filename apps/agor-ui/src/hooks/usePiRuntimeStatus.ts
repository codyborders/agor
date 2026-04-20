/**
 * Hook for loading the Pi runtime status (model registry + auth state).
 *
 * Used by the Pi session config forms to populate Provider/Model dropdowns
 * with everything in Pi's model registry (built-in + custom). Reads the
 * daemon's pi-runtime service via ClientContext so deep-tree components
 * don't need to thread a client prop.
 *
 * Status is cached module-wide and shared across consumers — opening the
 * same modal twice doesn't trigger two pi-runtime.find() round-trips. Call
 * `refresh()` to force a fresh fetch (e.g. after the user edits Pi providers
 * in settings and returns to a session form).
 */

import type { AgorClient } from '@agor/core/api';
import type { PiRuntimeStatus } from '@agor/core/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useClient } from '@/contexts/ClientContext';

export interface UsePiRuntimeStatusResult {
  status: PiRuntimeStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface CacheEntry {
  status: PiRuntimeStatus | null;
  fetchedAtMs: number;
}

const CACHE_TTL_MS = 10_000;

/**
 * Module-scoped cache and in-flight promise, keyed by client identity so a
 * client reconnect (new object) starts fresh. This prevents the N-consumers →
 * N-requests problem when several components mount the hook simultaneously.
 */
const cacheByClient = new WeakMap<AgorClient, CacheEntry>();
const inflightByClient = new WeakMap<AgorClient, Promise<PiRuntimeStatus>>();
const subscribersByClient = new WeakMap<AgorClient, Set<() => void>>();

function notifySubscribers(client: AgorClient): void {
  const subscribers = subscribersByClient.get(client);
  if (!subscribers) return;
  for (const subscriber of subscribers) {
    subscriber();
  }
}

async function fetchStatus(client: AgorClient, force: boolean): Promise<PiRuntimeStatus> {
  if (!force) {
    const cached = cacheByClient.get(client);
    if (cached?.status && Date.now() - cached.fetchedAtMs < CACHE_TTL_MS) {
      return cached.status;
    }
    const inflight = inflightByClient.get(client);
    if (inflight) return inflight;
  }

  const promise = (async () => {
    const next = (await client.service('pi-runtime').find({})) as PiRuntimeStatus;
    cacheByClient.set(client, { status: next, fetchedAtMs: Date.now() });
    notifySubscribers(client);
    return next;
  })();

  inflightByClient.set(client, promise);
  try {
    return await promise;
  } finally {
    inflightByClient.delete(client);
  }
}

export function usePiRuntimeStatus(): UsePiRuntimeStatusResult {
  const client = useClient();
  const [status, setStatus] = useState<PiRuntimeStatus | null>(() =>
    client ? (cacheByClient.get(client)?.status ?? null) : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<AgorClient | null>(client);
  clientRef.current = client;

  // Subscribe to cross-consumer cache updates so sibling hooks share the
  // result of a single fetch.
  useEffect(() => {
    if (!client) return;
    const subscriber = () => {
      const entry = cacheByClient.get(client);
      if (entry) setStatus(entry.status);
    };
    let subscribers = subscribersByClient.get(client);
    if (!subscribers) {
      subscribers = new Set();
      subscribersByClient.set(client, subscribers);
    }
    subscribers.add(subscriber);
    return () => {
      subscribers?.delete(subscriber);
    };
  }, [client]);

  const refresh = useCallback(async () => {
    const currentClient = clientRef.current;
    if (!currentClient) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchStatus(currentClient, /*force=*/ true);
      setStatus(next);
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to load Pi runtime status');
    } finally {
      setLoading(false);
    }
  }, []);

  // On mount / client change, serve from cache if fresh and otherwise fetch.
  useEffect(() => {
    if (!client) return;
    const cached = cacheByClient.get(client);
    if (cached?.status && Date.now() - cached.fetchedAtMs < CACHE_TTL_MS) {
      setStatus(cached.status);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStatus(client, /*force=*/ false)
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setError((err as Error)?.message ?? 'Failed to load Pi runtime status');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return { status, loading, error, refresh };
}
