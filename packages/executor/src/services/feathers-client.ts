/**
 * Feathers Client for Executor
 *
 * Creates authenticated connection to daemon for database/service operations.
 * Uses session token for authentication instead of user credentials.
 */

import { type AgorClient, createClient } from '@agor/core/api';

// Re-export AgorClient type for use in other executor files
export type { AgorClient } from '@agor/core/api';

/**
 * In-memory storage for executor authentication
 * Executors need to store authentication for subsequent requests but can't use localStorage
 */
class MemoryStorage {
  private store: Record<string, string> = {};

  async getItem(key: string): Promise<string | null> {
    return this.store[key] || null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store[key] = value;
  }

  async removeItem(key: string): Promise<void> {
    delete this.store[key];
  }
}

/**
 * Create Feathers client connected to daemon with session token authentication
 *
 * @param daemonUrl - URL of the daemon (e.g., http://localhost:3030)
 * @param sessionToken - Session token for authentication
 * @returns Authenticated Feathers client
 */
export async function createExecutorClient(
  daemonUrl: string,
  sessionToken: string
): Promise<AgorClient> {
  // CRITICAL FIX: Use in-memory storage for authentication
  // Without this, the authentication result is discarded and subsequent requests fail
  const storage = new MemoryStorage();

  // Create client with custom storage (don't auto-connect, we'll connect manually)
  const client = createClient(daemonUrl, false, {
    verbose: true, // Log connection status for debugging
    reconnectionAttempts: 5, // Allow more retries for transient network hiccups during long-running tasks
  });

  // Overwrite the app-level storage that createClient installed with ours.
  // createClient() calls `client.configure(authentication({ storage: undefined }))`
  // for Node, which persists a `StorageWrapper(undefined)` at
  // `app.get('storage')`. The auth client's `storage` getter reads that value
  // live on every setAccessToken/getAccessToken call, so replacing it here
  // is enough — a second `client.configure(authentication({storage}))` call
  // wouldn't override it because the auth client constructor reads
  // `app.get('storage') || options.storage` and short-circuits on the
  // existing wrapper. Without this, setAccessToken throws
  // `TypeError: _a.setItem is not a function` because the wrapped storage
  // is undefined.
  client.set('storage', storage);

  // Connect the socket
  client.io.connect();

  // Wait for connection
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Connection timeout'));
    }, 5000);

    client.io.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });

    client.io.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  console.log('[executor] Connected to daemon via Feathers client');

  // Authenticate with session token (which is now a JWT!)
  // This uses the standard JWT strategy - no custom strategy needed
  // Session tokens are JWTs containing { sub: userId, sessionId: sessionId }
  await client.authenticate({
    strategy: 'jwt',
    accessToken: sessionToken,
  });

  console.log('[executor] Authenticated with session token (JWT)');

  // Re-authenticate automatically on socket reconnect
  // When socket.io reconnects after a transport error, the new socket is unauthenticated.
  // Without this, all subsequent API calls fail with "NotAuthenticated" and the executor crashes.
  // This is critical for long-running SDK turns (Codex, Gemini) where transient network hiccups
  // can cause socket disconnects mid-execution.
  // NOTE: 'reconnect' is a Manager event, not a Socket event.
  // client.io is the Socket; client.io.io is the Manager.
  client.io.io.on('reconnect', async (attemptNumber: number) => {
    console.log(`[executor] Socket reconnected (attempt ${attemptNumber}), re-authenticating...`);
    try {
      // Try reAuthenticate first — uses stored credentials from MemoryStorage
      await client.reAuthenticate(true);
      console.log('[executor] Re-authenticated successfully after reconnect');
    } catch {
      // Fallback: authenticate with raw JWT if storage-based re-auth fails
      try {
        await client.authenticate({
          strategy: 'jwt',
          accessToken: sessionToken,
        });
        console.log('[executor] Re-authenticated with JWT fallback after reconnect');
      } catch (error) {
        console.error('[executor] Re-authentication failed after reconnect:', error);
      }
    }
  });

  return client;
}

/**
 * Create Feathers client (alias for createExecutorClient for backward compatibility)
 */
export const createFeathersClient = createExecutorClient;
