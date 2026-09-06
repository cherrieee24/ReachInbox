import { connectDatabase, disconnectDatabase } from '../config/prisma.js';
import { closeRedisConnections } from '../config/redis.js';
import { closeEmailQueue } from '../queues/email.queue.js';
import { closeMailer } from '../services/mailer.service.js';
import { recoverPendingSends } from '../services/recovery.service.js';
import { logger } from '../utils/logger.js';
import { startEmailWorker, stopEmailWorker } from './email.worker.js';

/**
 * Standalone worker entrypoint (`npm run worker`), for running senders as
 * their own process — or several — separate from the API. The API can then be
 * started with WORKER_ENABLED=false so it only serves HTTP.
 */
async function main(): Promise<void> {
  await connectDatabase();
  startEmailWorker();
  await recoverPendingSends();
  logger.info('Worker process ready');
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, draining worker`);

  const guard = setTimeout(() => process.exit(1), 30_000);
  guard.unref();

  await stopEmailWorker();
  await closeEmailQueue();
  closeMailer();
  await closeRedisConnections();
  await disconnectDatabase();

  clearTimeout(guard);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void main().catch((error: unknown) => {
  logger.error('Worker failed to start', error);
  process.exit(1);
});
