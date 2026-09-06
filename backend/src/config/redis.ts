import { Redis, type RedisOptions } from 'ioredis';
import { redisConfig } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null` so a blocking command is never
 * aborted mid-wait — without it, workers drop jobs during a Redis blip.
 */
const options: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times) => Math.min(times * 200, 5_000),
};

const connections = new Set<Redis>();

/**
 * BullMQ needs separate connections for the queue and each worker (a blocking
 * worker connection cannot also serve regular commands), so this is a factory
 * rather than a singleton. Every instance is tracked for graceful shutdown.
 */
export function createRedisConnection(label: string): Redis {
  const client = new Redis(redisConfig().url, options);
  connections.add(client);

  client.on('error', (error: Error) => {
    logger.error(`Redis (${label}) error`, error.message);
  });
  client.on('end', () => connections.delete(client));

  return client;
}

export async function checkRedisHealth(): Promise<{ connected: boolean; latencyMs?: number; error?: string }> {
  const client = new Redis(redisConfig().url, { ...options, lazyConnect: true, retryStrategy: () => null });
  const startedAt = Date.now();
  try {
    await client.connect();
    await client.ping();
    return { connected: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : 'Unknown Redis error' };
  } finally {
    client.disconnect();
  }
}

/** Closes every tracked connection, letting in-flight commands finish. */
export async function closeRedisConnections(): Promise<void> {
  const open = [...connections];
  connections.clear();
  await Promise.all(open.map((client) => client.quit().catch(() => client.disconnect())));
  if (open.length > 0) logger.info(`Closed ${open.length} Redis connection(s)`);
}
