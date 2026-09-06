import { DelayedError, Worker, type Job } from 'bullmq';
import { workerConfig } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { createRedisConnection } from '../config/redis.js';
import { EMAIL_QUEUE_NAME, type EmailJobPayload } from '../queues/email.queue.js';
import { describeTransport, sendEmail } from '../services/mailer.service.js';
import {
  acquireSendSlot,
  claimLimitNotification,
  releaseSendSlot,
  windowEndsAt,
} from '../services/rateLimiter.service.js';
import { notifyAsync } from '../services/slack.service.js';
import { indexRecipientAsync } from '../services/search.service.js';
import {
  WORKER_ID,
  clearLease,
  claimRecipientForSend,
  releaseClaim,
} from '../services/delivery.service.js';
import { logger } from '../utils/logger.js';

let worker: Worker<EmailJobPayload> | null = null;

/** Terminal outcomes the processor can report without throwing. */
export type Outcome =
  | { result: 'sent'; messageId: string; previewUrl: string | null }
  | { result: 'skipped'; reason: string };

/**
 * Ordering offset for a throttled job.
 *
 * Everything deferred out of a full window would otherwise wake at exactly the
 * same instant and be picked up in arbitrary order. Spacing each job by its
 * rank within its own campaign keeps the original sequence: recipient 11 wakes
 * before recipient 12. The offset is capped so it can never spill past the
 * window it was moved into.
 */
async function orderingOffsetMs(
  emailJobId: string,
  scheduledAt: Date,
  minDelayMs: number,
): Promise<number> {
  const rank = await prisma.emailRecipient.count({
    where: {
      emailJobId,
      scheduledAt: { lt: scheduledAt },
      status: { in: ['PENDING', 'SCHEDULED', 'PROCESSING'] },
    },
  });
  return Math.min(rank * Math.max(minDelayMs, 1), 3_500_000);
}

/**
 * Processes one recipient.
 *
 * Idempotency has two layers. The BullMQ job id is the recipient's
 * idempotency key, so Redis refuses a duplicate enqueue outright. And because
 * a retry after a crash can still redeliver an existing job, the processor
 * claims the row with a conditional UPDATE: only a transition out of a
 * pending state succeeds, so exactly one worker ever sends a given email.
 */
export async function processSendJob(
  job: Job<EmailJobPayload>,
  token?: string,
): Promise<Outcome> {
  const { emailRecipientId, emailJobId, userId } = job.data;
  const attempt = job.attemptsMade + 1;

  const log = { jobId: job.id, recipientId: emailRecipientId, emailJobId, userId, attempt };

  const recipient = await prisma.emailRecipient.findUnique({
    where: { id: emailRecipientId },
    include: {
      emailJob: {
        select: {
          subject: true,
          body: true,
          status: true,
          hourlyLimit: true,
          sender: {
            select: {
              id: true,
              name: true,
              fromEmail: true,
              host: true,
              port: true,
              secure: true,
              username: true,
              password: true,
            },
          },
        },
      },
    },
  });

  if (!recipient) {
    logger.warn('Send skipped: recipient no longer exists', log);
    return { result: 'skipped', reason: 'recipient_deleted' };
  }

  // The decisive idempotency check: a retry of an already-delivered job — from
  // a crash, a stalled-job reclaim, or a manual replay — stops here rather
  // than emailing the person twice.
  if (recipient.status === 'SENT') {
    logger.info('Send skipped: already delivered', {
      ...log,
      providerMessageId: recipient.providerMessageId,
      sentAt: recipient.sentAt,
    });
    return { result: 'skipped', reason: 'already_sent' };
  }
  if (recipient.status === 'CANCELLED' || recipient.emailJob.status === 'CANCELLED') {
    logger.info('Send skipped: cancelled', log);
    return { result: 'skipped', reason: 'cancelled' };
  }

  // Take the lease. PostgreSQL arbitrates: exactly one caller can win, and a
  // row someone else is actively sending is never handed over.
  const claim = await claimRecipientForSend(emailRecipientId, WORKER_ID);

  if (!claim.claimed) {
    logger.info('Send skipped: could not claim row', { ...log, reason: claim.reason });
    return { result: 'skipped', reason: claim.reason };
  }

  // First send of the campaign flips it to PROCESSING.
  await prisma.emailJob.updateMany({
    where: { id: emailJobId, status: 'SCHEDULED' },
    data: { status: 'PROCESSING', startedAt: new Date() },
  });

  const sender = recipient.emailJob.sender;

  // ---- Throttle -----------------------------------------------------------
  // A campaign may ask for less than the global ceiling, never more.
  const { minDelayMs, maxEmailsPerHour } = workerConfig();
  const limit = Math.min(recipient.emailJob.hourlyLimit, maxEmailsPerHour);

  const slot = await acquireSendSlot({ senderId: sender.id, limit, minDelayMs });

  if (!slot.allowed) {
    // Refused, not failed. Release the claim, push the job into the future and
    // hand it back to BullMQ as a delayed job — no attempt is consumed and the
    // send is never dropped.
    // refundAttempt: the send never happened, so it must not consume a retry.
    await releaseClaim(emailRecipientId, 'SCHEDULED', WORKER_ID, true);

    const offset =
      slot.reason === 'hour_limit'
        ? await orderingOffsetMs(emailJobId, recipient.scheduledAt, minDelayMs)
        : 0;
    const runAt = Date.now() + slot.retryAfterMs + offset;

    // Write the new time back to PostgreSQL. Without this the row keeps its
    // original `scheduledAt` while the real run time lives only in Redis: the
    // UI would show a send time that has already passed, and a rebuild from
    // the database after a Redis loss would re-enqueue everything as overdue.
    // The database has to stay the source of truth for *when*, not just what.
    await prisma.emailRecipient.update({
      where: { id: emailRecipientId },
      data: { scheduledAt: new Date(runAt) },
    });

    // Announce a full window once per sender per hour. notifyAsync never
    // throws and no-ops when Slack is not connected, so a missing or broken
    // Slack integration can never disturb the send pipeline.
    if (slot.reason === 'hour_limit') {
      void claimLimitNotification(sender.id)
        .then((isFirst) => {
          if (!isFirst) return;
          const resumesAt = new Date(windowEndsAt()).toISOString();
          notifyAsync(
            userId,
            `:warning: Email rate limit reached for sender *${sender.fromEmail}* ` +
              `(${slot.limit}/hour). Remaining emails have been rescheduled and resume after ${resumesAt}.`,
          );
        })
        .catch(() => undefined);
    }

    logger.info('Send deferred by throttle', {
      ...log,
      to: recipient.email,
      senderId: sender.id,
      reason: slot.reason,
      used: slot.used,
      limit: slot.limit,
      retryAfterMs: slot.retryAfterMs,
      orderingOffsetMs: offset,
      runAt: new Date(runAt),
      windowEndsAt: new Date(windowEndsAt()),
    });

    await job.moveToDelayed(runAt, token);
    // Tells BullMQ the job was rescheduled rather than completed or failed.
    throw new DelayedError();
  }

  const startedAt = Date.now();
  logger.info('Sending email', {
    ...log,
    to: recipient.email,
    senderId: sender.id,
    rateUsed: slot.used,
    rateLimit: slot.limit,
  });

  try {
    const delivery = await sendEmail({
      to: recipient.email,
      subject: recipient.emailJob.subject,
      body: recipient.emailJob.body,
      fromName: sender.name,
      fromEmail: sender.fromEmail,
      senderId: sender.id,
      // A sender may carry its own mailbox credentials; otherwise the shared
      // Ethereal account is used.
      credentials: {
        host: sender.host ?? undefined,
        port: sender.port ?? undefined,
        secure: sender.secure,
        user: sender.username ?? undefined,
        password: sender.password ?? undefined,
      },
    });

    await prisma.$transaction([
      prisma.emailRecipient.update({
        where: { id: emailRecipientId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          errorMessage: null,
          providerMessageId: delivery.messageId,
          previewUrl: delivery.previewUrl,
        },
      }),
      prisma.emailJob.update({
        where: { id: emailJobId },
        data: { sentCount: { increment: 1 } },
      }),
    ]);

    await clearLease(emailRecipientId);
    await finaliseJobIfComplete(emailJobId);
    // Reflect the SENT status in the search index, without delaying the worker.
    indexRecipientAsync(emailRecipientId);

    logger.info('Email sent', {
      ...log,
      to: recipient.email,
      providerMessageId: delivery.messageId,
      previewUrl: delivery.previewUrl,
      durationMs: Date.now() - startedAt,
    });
    return { result: 'sent', messageId: delivery.messageId, previewUrl: delivery.previewUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown send failure';
    const isFinalAttempt = attempt >= (job.opts.attempts ?? 1);

    // No email left the building, so give the reserved slot back rather than
    // charging the sender's hourly budget for a failed attempt.
    await releaseSendSlot(sender.id);

    if (isFinalAttempt) {
      await prisma.$transaction([
        prisma.emailRecipient.update({
          where: { id: emailRecipientId },
          data: { status: 'FAILED', errorMessage: message.slice(0, 1000) },
        }),
        prisma.emailJob.update({
          where: { id: emailJobId },
          data: { failedCount: { increment: 1 } },
        }),
      ]);
      await clearLease(emailRecipientId);
      await finaliseJobIfComplete(emailJobId);
      indexRecipientAsync(emailRecipientId);
      logger.error('Send failed permanently', {
        ...log,
        to: recipient.email,
        error: message,
        durationMs: Date.now() - startedAt,
      });
    } else {
      // Return to a claimable state so the backoff retry can pick it up.
      await prisma.emailRecipient.update({
        where: { id: emailRecipientId },
        data: { errorMessage: message.slice(0, 1000) },
      });
      await releaseClaim(emailRecipientId, 'SCHEDULED', WORKER_ID);
      logger.warn('Send failed, will retry', {
        ...log,
        to: recipient.email,
        error: message,
        nextAttempt: attempt + 1,
        maxAttempts: job.opts.attempts ?? 1,
      });
    }

    // Rethrow so BullMQ applies its backoff and retry policy.
    throw error;
  }
}

/** Marks a campaign complete once no recipient is still pending. */
async function finaliseJobIfComplete(emailJobId: string): Promise<void> {
  const outstanding = await prisma.emailRecipient.count({
    where: { emailJobId, status: { in: ['PENDING', 'SCHEDULED', 'PROCESSING'] } },
  });
  if (outstanding > 0) return;

  const failed = await prisma.emailRecipient.count({
    where: { emailJobId, status: 'FAILED' },
  });
  const total = await prisma.emailRecipient.count({ where: { emailJobId } });

  await prisma.emailJob.updateMany({
    where: { id: emailJobId, status: { in: ['SCHEDULED', 'PROCESSING'] } },
    data: {
      status: failed === total ? 'FAILED' : 'COMPLETED',
      completedAt: new Date(),
    },
  });
  logger.info('Campaign finished', { emailJobId, failed, total });
}

/** Starts the worker. Concurrency comes from WORKER_CONCURRENCY. */
export function startEmailWorker(): Worker<EmailJobPayload> {
  if (worker) return worker;

  const { concurrency } = workerConfig();

  worker = new Worker<EmailJobPayload>(EMAIL_QUEUE_NAME, processSendJob, {
    connection: createRedisConnection('email-worker'),
    concurrency,
    // Required for job.moveToDelayed(): the processor receives the lock token
    // so it can hand a throttled job back to the delayed set itself.
    autorun: true,
  });

  worker.on('failed', (job, error) => {
    // A throttled job re-enters the delayed set; that is not a failure.
    if (error instanceof DelayedError || error.name === 'DelayedError') return;
    logger.warn('Job attempt failed', { jobId: job?.id, error: error.message });
  });
  worker.on('error', (error) => {
    logger.error('Worker error', error);
  });
  worker.on('stalled', (jobId) => {
    logger.warn('Job stalled and will be reclaimed', { jobId });
  });

  logger.info('Email worker started', { concurrency, transport: describeTransport() });
  return worker;
}

/**
 * Stops accepting new jobs and waits for in-flight sends to finish, so a
 * deploy never interrupts a send mid-flight.
 */
export async function stopEmailWorker(): Promise<void> {
  if (!worker) return;
  logger.info('Draining email worker…');
  await worker.close();
  worker = null;
  logger.info('Email worker stopped');
}
