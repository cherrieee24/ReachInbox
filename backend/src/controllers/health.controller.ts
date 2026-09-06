import type { Request, Response } from 'express';
import { checkDatabaseHealth } from '../config/prisma.js';
import { checkRedisHealth } from '../config/redis.js';
import { checkSearchHealth } from '../config/elasticsearch.js';
import { sendSuccess } from '../utils/apiResponse.js';

/**
 * Reports process and dependency health. Returns 503 when a dependency is
 * down so a load balancer takes the instance out of rotation.
 */
export async function getHealth(_req: Request, res: Response): Promise<void> {
  const [database, redis, search] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkSearchHealth(),
  ]);
  // Search is a convenience, not a dependency: its absence degrades the
  // feature but must not take the instance out of rotation.
  const healthy = database.connected && redis.connected;

  sendSuccess(
    res,
    {
      status: healthy ? 'ok' : 'degraded',
      service: 'reachinbox-scheduler-backend',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      dependencies: { database, redis, search },
    },
    { status: healthy ? 200 : 503 },
  );
}
