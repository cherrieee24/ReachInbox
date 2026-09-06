import { prisma } from '../config/prisma.js';
import { enqueueSends } from '../queues/email.queue.js';
import { leaseMs } from './delivery.service.js';
import { logger } from '../utils/logger.js';

const BATCH_SIZE = 500;

/**
 * Re-enqueues every send that PostgreSQL still considers pending.
 *
 * Runs once at boot — it is reconciliation, not a scheduler, so there is no
 * timer, interval or cron involved. BullMQ's own delayed jobs survive a
 * restart because they live in Redis (AOF-persisted), so normally this finds
 * that every job already exists and Redis rejects the duplicate ids. It earns
 * its keep when Redis was flushed, was down during a schedule call, or the
 * process died between the database commit and the enqueue.
 *
 * Recovery is safe precisely because the job id is the recipient's
 * idempotency key: re-adding an existing job is a no-op, and a send already
 * in flight is protected by the worker's lease. A restart therefore resumes a
 * campaign where it left off rather than restarting it.
 *
 * PROCESSING rows with an expired lease are included deliberately. BullMQ's
 * stalled-job detection normally redelivers those, but it can only do so while
 * the job still exists in Redis. If Redis lost it — a flush, an eviction, or
 * retries exhausted while the row was mid-flight — nothing else would ever
 * pick the row up and the campaign would hang forever. Their lease has already
 * expired, so re-enqueueing cannot interrupt a live send.
 */
export async function recoverPendingSends(): Promise<{
  scanned: number;
  enqueued: number;
  reclaimed: number;
}> {
  const staleBefore = new Date(Date.now() - leaseMs());
  let cursor: string | undefined;
  let scanned = 0;
  let enqueued = 0;

  // Counted separately: a non-zero value means workers died mid-send.
  const reclaimed = await prisma.emailRecipient.count({
    where: {
      status: 'PROCESSING',
      lockedAt: { lt: staleBefore },
      emailJob: { status: { in: ['SCHEDULED', 'PROCESSING'] } },
    },
  });

  for (;;) {
    const batch = await prisma.emailRecipient.findMany({
      where: {
        emailJob: { status: { in: ['SCHEDULED', 'PROCESSING'] } },
        OR: [
          { status: { in: ['PENDING', 'SCHEDULED'] } },
          // Abandoned by a worker that never came back.
          { status: 'PROCESSING', lockedAt: { lt: staleBefore } },
        ],
      },
      select: {
        id: true,
        userId: true,
        emailJobId: true,
        scheduledAt: true,
        idempotencyKey: true,
        emailJob: { select: { senderId: true } },
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (batch.length === 0) break;
    scanned += batch.length;

    enqueued += await enqueueSends(
      batch.map((row) => ({
        emailRecipientId: row.id,
        emailJobId: row.emailJobId,
        userId: row.userId,
        senderId: row.emailJob.senderId,
        scheduledAt: row.scheduledAt,
        idempotencyKey: row.idempotencyKey,
      })),
    );

    cursor = batch[batch.length - 1]?.id;
    if (batch.length < BATCH_SIZE) break;
  }

  if (scanned > 0) {
    logger.info('Recovery: reconciled pending sends with the queue', {
      scanned,
      enqueued,
      reclaimedFromDeadWorkers: reclaimed,
    });
  } else {
    logger.info('Recovery: no pending sends to reconcile');
  }
  return { scanned, enqueued, reclaimed };
}
