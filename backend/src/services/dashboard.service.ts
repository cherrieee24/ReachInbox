import { prisma } from '../config/prisma.js';
import { getQueueCounts } from '../queues/email.queue.js';
import { logger } from '../utils/logger.js';

export interface QueueSnapshot {
  state: 'healthy' | 'degraded' | 'paused';
  /** Jobs a worker is running right now (queue-wide, not per user). */
  active: number;
  /** This user's sends still waiting to run. */
  waiting: number;
  /** Queue-wide BullMQ counts, null when Redis is unreachable. */
  delayed: number | null;
  failed: number | null;
}

export interface DashboardStats {
  scheduled: number;
  sent: number;
  failed: number;
  totalCampaigns: number;
  activeCampaigns: number;
  queue: QueueSnapshot;
  nextSendAt: string | null;
}

/** All counts scoped to the authenticated user. */
export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const [scheduled, sent, failed, processing, totalCampaigns, activeCampaigns, next] =
    await Promise.all([
      prisma.emailRecipient.count({ where: { userId, status: { in: ['PENDING', 'SCHEDULED'] } } }),
      prisma.emailRecipient.count({ where: { userId, status: 'SENT' } }),
      prisma.emailRecipient.count({ where: { userId, status: 'FAILED' } }),
      prisma.emailRecipient.count({ where: { userId, status: 'PROCESSING' } }),
      prisma.emailJob.count({ where: { userId } }),
      prisma.emailJob.count({ where: { userId, status: { in: ['SCHEDULED', 'PROCESSING'] } } }),
      prisma.emailRecipient.findFirst({
        where: { userId, status: { in: ['PENDING', 'SCHEDULED'] } },
        orderBy: { scheduledAt: 'asc' },
        select: { scheduledAt: true },
      }),
    ]);

  // Overdue work that nothing has picked up means the queue is not draining.
  const overdue = await prisma.emailRecipient.count({
    where: { userId, status: { in: ['PENDING', 'SCHEDULED'] }, scheduledAt: { lt: new Date() } },
  });

  // A dashboard must still render when Redis is down.
  let counts: Awaited<ReturnType<typeof getQueueCounts>> | null = null;
  try {
    counts = await getQueueCounts();
  } catch (error) {
    logger.warn('Queue counts unavailable', error instanceof Error ? error.message : error);
  }

  return {
    scheduled,
    sent,
    failed,
    totalCampaigns,
    activeCampaigns,
    queue: {
      state: counts === null ? 'paused' : overdue > 0 ? 'degraded' : 'healthy',
      active: counts?.active ?? processing,
      waiting: scheduled,
      delayed: counts?.delayed ?? null,
      failed: counts?.failed ?? null,
    },
    nextSendAt: next?.scheduledAt.toISOString() ?? null,
  };
}
