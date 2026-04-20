import type { AgorClient } from '@agor/core/api';
import { createContext, useContext } from 'react';

/**
 * ClientContext - shares the connected AgorClient without prop drilling.
 *
 * Populated at the App root from useAgorClient(). Hooks that need the client
 * (e.g. usePiRuntimeStatus) read from this context instead of reaching into
 * window globals. Returns `null` until the daemon connection is ready.
 */
const ClientContext = createContext<AgorClient | null>(null);

export const ClientProvider = ClientContext.Provider;

/**
 * Hook returning the daemon client, or null while connecting/disconnected.
 */
export function useClient(): AgorClient | null {
  return useContext(ClientContext);
}
