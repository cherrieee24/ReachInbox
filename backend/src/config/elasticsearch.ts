import { Client } from '@elastic/elasticsearch';
import { searchConfig } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * Elasticsearch client with a small circuit breaker.
 *
 * The index is a convenience, never a dependency: PostgreSQL is the source of
 * truth. If the cluster goes down, indexing calls are skipped and search falls
 * back to the database, so a search outage never becomes an application
 * outage. After a failure the client is skipped entirely for a cooldown
 * period, so a hard-down cluster is not hammered on every request.
 */

let client: Client | null = null;
let unavailableUntil = 0;

export function getSearchClient(): Client {
  if (client) return client;

  const config = searchConfig();
  client = new Client({
    node: config.node,
    requestTimeout: config.requestTimeoutMs,
    // Fail fast: a slow cluster must not hold a request open.
    maxRetries: 1,
    ...(config.username
      ? { auth: { username: config.username, password: config.password } }
      : {}),
  });
  return client;
}

/** False while the breaker is open after a recent failure. */
export function isSearchAvailable(): boolean {
  return Date.now() >= unavailableUntil;
}

export function markSearchUnavailable(error: unknown): void {
  const { cooldownMs } = searchConfig();
  const wasAvailable = isSearchAvailable();
  unavailableUntil = Date.now() + cooldownMs;
  if (wasAvailable) {
    logger.warn('Elasticsearch unavailable, pausing search calls', {
      cooldownMs,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function markSearchAvailable(): void {
  if (unavailableUntil !== 0) {
    unavailableUntil = 0;
    logger.info('Elasticsearch is reachable again');
  }
}

/**
 * Runs an Elasticsearch operation, returning `fallback` instead of throwing if
 * the cluster is unreachable. Every call site is therefore non-fatal.
 */
export async function withSearch<T>(
  operation: (client: Client) => Promise<T>,
  fallback: T,
  context: Record<string, unknown> = {},
): Promise<T> {
  if (!isSearchAvailable()) return fallback;

  try {
    const result = await operation(getSearchClient());
    markSearchAvailable();
    return result;
  } catch (error) {
    markSearchUnavailable(error);
    logger.warn('Elasticsearch operation failed', {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export async function checkSearchHealth(): Promise<{
  connected: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const startedAt = Date.now();
  try {
    await getSearchClient().ping();
    markSearchAvailable();
    return { connected: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown Elasticsearch error',
    };
  }
}

export async function closeSearchClient(): Promise<void> {
  if (!client) return;
  await client.close();
  client = null;
  logger.info('Elasticsearch client closed');
}
