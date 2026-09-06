import { createApp } from './app.js';
import { env, workerConfig } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/prisma.js';
import { closeRedisConnections } from './config/redis.js';
import { closeSearchClient } from './config/elasticsearch.js';
import { closeEmailQueue } from './queues/email.queue.js';
import { ensureIndex } from './services/search.service.js';
import { recoverPendingSends } from './services/recovery.service.js';
import { closeMailer } from './services/mailer.service.js';
import { startEmailWorker, stopEmailWorker } from './workers/email.worker.js';
import { logger } from './utils/logger.js';

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info(`Backend listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

async function bootstrap(): Promise<void> {
  await connectDatabase();

  if (workerConfig().enabled) {
    startEmailWorker();
  } else {
    logger.info('Worker disabled in this process (WORKER_ENABLED=false)');
  }

  // One-shot reconciliation, after the worker is listening so anything
  // already overdue is picked up immediately.
  await recoverPendingSends();

  // Non-blocking: a missing search cluster must not stop the API booting.
  void ensureIndex();
}

void bootstrap().catch((error: unknown) => {
  logger.error('Startup failed', error);
});

let shuttingDown = false;

/**
 * Ordered shutdown: stop taking new work, finish what is in flight, then
 * release connections.
 *
 * 1. HTTP server — no new requests can enqueue anything.
 * 2. Worker — drains in-flight sends rather than killing them mid-delivery.
 * 3. Queue and Redis — safe once nothing else can touch them.
 * 4. PostgreSQL — last, because steps 2 and 3 still write to it.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully`);

  // Never hang a deploy: exit anyway if draining stalls.
  const guard = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 30_000);
  guard.unref();

  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    logger.info('HTTP server closed');

    await stopEmailWorker();
    await closeEmailQueue();
    closeMailer();
    await closeSearchClient();
    await closeRedisConnections();
    await disconnectDatabase();

    logger.info('Shutdown complete');
    clearTimeout(guard);
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
