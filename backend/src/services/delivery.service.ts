import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Delivery leases — the mechanism that makes a send happen at most once.
 *
 * ## Why a lease rather than a status flag
 *
 * Checking `status === 'PROCESSING'` cannot distinguish "I crashed earlier and
 * am resuming" from "another worker is sending this right now". A lease can:
 * whoever holds `lockedBy` owns the row, and ownership is only transferable
 * once the lease has visibly expired.
 *
 * The claim is a single conditional UPDATE, so PostgreSQL — not application
 * code — arbitrates. Row locking makes concurrent updates serialise, and only
 * the transaction whose WHERE clause still matches performs a write. Everyone
 * else gets `count: 0` and stands down.
 *
 * A row is claimable when it is:
 *   - PENDING or SCHEDULED (nobody has started), or
 *   - PROCESSING but its lease is older than `LEASE_MS` (the previous owner
 *     died without finishing).
 *
 * Terminal rows (SENT, FAILED, CANCELLED) are never claimable, which is what
 * stops a redelivered job from sending a second copy.
 */

/** How long a worker may hold a row before it is considered abandoned. */
const LEASE_MS = Number(process.env.DELIVERY_LEASE_MS ?? 5 * 60 * 1000);

/** Identifies this process in `lockedBy`; useful when reading stuck rows. */
export const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

export type ClaimOutcome =
  | { claimed: true }
  | { claimed: false; reason: 'missing' | 'already_sent' | 'cancelled' | 'held_by_other' };

export async function claimRecipientForSend(
  recipientId: string,
  workerId: string = WORKER_ID,
): Promise<ClaimOutcome> {
  const staleBefore = new Date(Date.now() - LEASE_MS);

  const { count } = await prisma.emailRecipient.updateMany({
    where: {
      id: recipientId,
      OR: [
        { status: { in: ['PENDING', 'SCHEDULED'] } },
        // Reclaim a lease whose owner never came back.
        { status: 'PROCESSING', lockedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: 'PROCESSING',
      lockedBy: workerId,
      lockedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  if (count === 1) return { claimed: true };

  // Nothing was updated: explain why, for logging and for the caller.
  const row = await prisma.emailRecipient.findUnique({
    where: { id: recipientId },
    select: { status: true, lockedBy: true },
  });

  if (!row) return { claimed: false, reason: 'missing' };
  if (row.status === 'SENT') return { claimed: false, reason: 'already_sent' };
  if (row.status === 'CANCELLED') return { claimed: false, reason: 'cancelled' };
  return { claimed: false, reason: 'held_by_other' };
}

/**
 * Releases a lease without changing the outcome, so a retry can pick it up.
 *
 * `refundAttempt` undoes the increment the claim made — used when the send was
 * never attempted (throttled, for instance), so a deferral does not eat into
 * the retry budget. It is applied in the same conditional update as the
 * release, so a worker that no longer holds the lease cannot decrement
 * somebody else's counter.
 */
export async function releaseClaim(
  recipientId: string,
  nextStatus: 'PENDING' | 'SCHEDULED' = 'SCHEDULED',
  workerId: string = WORKER_ID,
  refundAttempt = false,
): Promise<boolean> {
  const { count } = await prisma.emailRecipient.updateMany({
    // Only the holder may release; a stale worker waking late cannot stomp
    // a lease that has since been handed to someone else.
    where: { id: recipientId, lockedBy: workerId, status: 'PROCESSING' },
    data: {
      status: nextStatus,
      lockedBy: null,
      lockedAt: null,
      ...(refundAttempt ? { attempts: { decrement: 1 } } : {}),
    },
  });
  return count === 1;
}

/**
 * Clears ownership on a row that has reached a terminal state.
 *
 * `lockedAt` is deliberately kept: it is the instant the send actually
 * started, which is the only precise record of dispatch pacing — `sentAt`
 * marks completion, and completions overlap under concurrency. Nothing reads
 * `lockedAt` without also filtering on `status: 'PROCESSING'`, so leaving it
 * on a terminal row is inert.
 */
export async function clearLease(recipientId: string): Promise<void> {
  await prisma.emailRecipient.updateMany({
    where: { id: recipientId },
    data: { lockedBy: null },
  });
}

/**
 * Reports rows whose lease has expired — a crashed worker's leftovers. BullMQ
 * redelivers the job itself, so this is for observability, not repair.
 */
export async function countStaleLeases(): Promise<number> {
  return prisma.emailRecipient.count({
    where: { status: 'PROCESSING', lockedAt: { lt: new Date(Date.now() - LEASE_MS) } },
  });
}

export function leaseMs(): number {
  return LEASE_MS;
}

export function logClaimRefusal(recipientId: string, reason: string): void {
  logger.debug('Claim refused', { recipientId, reason });
}
