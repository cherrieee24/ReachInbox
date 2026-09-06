import { Queue, type JobsOptions } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import { workerConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const EMAIL_QUEUE_NAME = 'email-send';

/**
 * Everything a worker needs to find its work — and nothing more. Subject,
 * body, recipient address and SMTP credentials stay in PostgreSQL: Redis is
 * an unencrypted job store, so no message content or secret is written to it.
 */
export interface EmailJobPayload {
  emailRecipientId: string;
  emailJobId: string;
  userId: string;
  senderId: string;
}

let queue: Queue<EmailJobPayload> | null = null;

export function getEmailQueue(): Queue<EmailJobPayload> {
  queue ??= new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
    connection: createRedisConnection('email-queue'),
  });
  return queue;
}

/** Retry policy shared by every enqueued send. */
export function defaultJobOptions(): JobsOptions {
  const { attempts, backoffMs, keepCompleted, keepFailed } = workerConfig();
  return {
    attempts,
    backoff: { type: 'exponential', delay: backoffMs },
    removeOnComplete: { count: keepCompleted },
    removeOnFail: { count: keepFailed },
  };
}

export interface PendingSend extends EmailJobPayload {
  scheduledAt: Date;
  /** Deterministic per (job, address) — reused as the BullMQ job id. */
  idempotencyKey: string;
}

/**
 * Enqueues one delayed job per recipient.
 *
 * Scheduling is entirely BullMQ's delayed-job mechanism: the delay is the
 * distance from now to the row's own `scheduledAt`. Nothing polls, and there
 * is no cron, timer or interval anywhere in this codebase.
 *
 * The BullMQ job id is the recipient's idempotency key, so re-enqueueing the
 * same send — after a restart, a replay, or a double API call — is silently
 * ignored by Redis instead of producing a second email.
 */
export async function enqueueSends(sends: PendingSend[]): Promise<number> {
  if (sends.length === 0) return 0;

  const { minDelayMs } = workerConfig();
  const now = Date.now();

  const jobs = sends.map((send) => ({
    name: 'send-email',
    data: {
      emailRecipientId: send.emailRecipientId,
      emailJobId: send.emailJobId,
      userId: send.userId,
      senderId: send.senderId,
    },
    opts: {
      ...defaultJobOptions(),
      jobId: send.idempotencyKey,
      // Overdue work runs after the floor, never instantly.
      delay: Math.max(minDelayMs, send.scheduledAt.getTime() - now),
    },
  }));

  await getEmailQueue().addBulk(jobs);
  logger.info(`Enqueued ${jobs.length} delayed send job(s)`);
  return jobs.length;
}

/** Removes not-yet-run jobs for a cancelled campaign. */
export async function removeSends(idempotencyKeys: string[]): Promise<number> {
  if (idempotencyKeys.length === 0) return 0;

  const q = getEmailQueue();
  const results = await Promise.all(
    idempotencyKeys.map(async (key) => {
      const job = await q.getJob(key);
      if (!job) return 0;
      try {
        await job.remove();
        return 1;
      } catch {
        // Already running or completed — the worker's own status check stops it.
        return 0;
      }
    }),
  );
  return results.reduce<number>((total, n) => total + n, 0);
}

export async function getQueueCounts() {
  return getEmailQueue().getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
}

export async function closeEmailQueue(): Promise<void> {
  if (!queue) return;
  await queue.close();
  queue = null;
  logger.info('Email queue closed');
}
