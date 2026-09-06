import { createHash } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { enqueueSends, removeSends } from '../queues/email.queue.js';
import { indexEmailJobAsync } from './search.service.js';
import { EMAIL_LIMITS, type ListQuery, type ScheduleEmailInput } from '../types/email.schema.js';
import { ErrorCode } from '../types/api.js';
import { AppError } from '../utils/AppError.js';

/**
 * Every function here takes `userId` as its first argument and folds it into
 * the query. Ownership is a WHERE clause, not a post-hoc check — a row that
 * belongs to someone else is invisible rather than forbidden, so the API never
 * leaks the existence of another user's campaign.
 */

/** Stable per (job, address): a retry recomputes the same key and is rejected. */
export function buildIdempotencyKey(jobId: string, email: string): string {
  return createHash('sha256').update(`${jobId}:${email.toLowerCase()}`).digest('hex').slice(0, 40);
}

/**
 * Send time for the nth recipient: spacing between sends, plus the hourly
 * ceiling, whichever pushes it later. Computed up front so the schedule is
 * durable before any queue exists.
 */
export function computeSendTime(
  start: Date,
  index: number,
  delaySeconds: number,
  hourlyLimit: number,
): Date {
  const bySpacing = index * delaySeconds * 1000;
  const byHourlyCap = Math.floor(index / hourlyLimit) * 3_600_000;
  return new Date(start.getTime() + Math.max(bySpacing, byHourlyCap));
}

const ACTIVE_STATUSES = ['PENDING', 'SCHEDULED', 'PROCESSING'] as const;
const TERMINAL_STATUSES = ['SENT', 'FAILED'] as const;

function searchFilter(search: string | undefined) {
  if (!search) return {};
  return {
    OR: [
      { email: { contains: search, mode: 'insensitive' as const } },
      { emailJob: { subject: { contains: search, mode: 'insensitive' as const } } },
    ],
  };
}

const recipientSelect = {
  id: true,
  email: true,
  scheduledAt: true,
  sentAt: true,
  status: true,
  errorMessage: true,
  attempts: true,
  providerMessageId: true,
  /** Ethereal capture link — surfaced for development and demos. */
  previewUrl: true,
  emailJob: { select: { id: true, subject: true } },
} as const;

async function listRecipients(
  userId: string,
  query: ListQuery,
  statuses: readonly string[],
  orderBy: Record<string, 'asc' | 'desc'>,
) {
  const where = {
    userId,
    status: { in: (query.status ? [query.status] : statuses) as never },
    ...searchFilter(query.search),
  };

  const [items, totalItems] = await Promise.all([
    prisma.emailRecipient.findMany({
      where,
      select: recipientSelect,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.emailRecipient.count({ where }),
  ]);

  return { items, totalItems };
}

export function listScheduled(userId: string, query: ListQuery) {
  return listRecipients(userId, query, ACTIVE_STATUSES, { scheduledAt: 'asc' });
}

export function listSent(userId: string, query: ListQuery) {
  return listRecipients(userId, query, TERMINAL_STATUSES, { sentAt: 'desc' });
}

/** One campaign, with a recipient status breakdown. Scoped to the owner. */
export async function getEmailJob(userId: string, id: string) {
  const job = await prisma.emailJob.findFirst({
    where: { id, userId },
    include: {
      sender: { select: { id: true, name: true, fromEmail: true, provider: true } },
      recipients: {
        select: recipientSelect,
        orderBy: { scheduledAt: 'asc' },
        take: 50,
      },
    },
  });

  if (!job) throw AppError.notFound('Email campaign not found');

  const grouped = await prisma.emailRecipient.groupBy({
    by: ['status'],
    where: { emailJobId: id },
    _count: { _all: true },
  });

  const breakdown = Object.fromEntries(grouped.map((row) => [row.status, row._count._all]));
  return { ...job, breakdown };
}

/** Resolves the sender to use, verifying it belongs to this user. */
async function resolveSender(userId: string, senderId?: string) {
  const sender = senderId
    ? await prisma.sender.findFirst({ where: { id: senderId, userId } })
    : await prisma.sender.findFirst({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });

  if (!sender) {
    throw AppError.of(
      senderId ? 404 : 400,
      ErrorCode.SENDER_NOT_FOUND,
      senderId
        ? 'That sender does not exist or does not belong to you'
        : 'No sender configured. Add a sender before scheduling a campaign.',
    );
  }
  return sender;
}

/**
 * Creates the campaign and one row per recipient in a single transaction, then
 * enqueues one delayed BullMQ job per recipient.
 *
 * The database write commits first, deliberately: PostgreSQL is the source of
 * truth and Redis is a projection of it. If enqueueing fails, the rows survive
 * and `recoverPendingSends()` re-enqueues them at the next boot. The reverse
 * order would risk a job pointing at a row that was never written.
 */
export async function scheduleEmails(
  userId: string,
  input: ScheduleEmailInput,
  idempotencyKey?: string,
) {
  const sender = await resolveSender(userId, input.senderId);

  // Fast path: this key already produced a campaign, so return that one.
  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(userId, idempotencyKey);
    if (existing) return existing;
  }

  const created = await prisma.$transaction(async (tx) => {
    const job = await tx.emailJob.create({
      data: {
        userId,
        senderId: sender.id,
        idempotencyKey: idempotencyKey ?? null,
        subject: input.subject,
        body: input.body,
        scheduledAt: input.startTime,
        delayBetweenEmails: input.delayBetweenEmails,
        hourlyLimit: input.hourlyLimit,
        status: 'SCHEDULED',
        totalRecipients: input.recipients.length,
      },
    });

    await tx.emailRecipient.createMany({
      data: input.recipients.map((email, index) => ({
        emailJobId: job.id,
        userId,
        email,
        scheduledAt: computeSendTime(
          input.startTime,
          index,
          input.delayBetweenEmails,
          input.hourlyLimit,
        ),
        status: 'SCHEDULED' as const,
        idempotencyKey: buildIdempotencyKey(job.id, email),
      })),
    });

    const rows = await tx.emailRecipient.findMany({
      where: { emailJobId: job.id },
      select: { id: true, scheduledAt: true, idempotencyKey: true },
    });

    return { job, rows };
  }).catch(async (error: unknown) => {
    // Two identical requests raced past the fast path. The unique index on
    // (userId, idempotencyKey) is what actually decides: one transaction
    // commits, the other is rejected here and resolves to the winner's row.
    if (idempotencyKey && isUniqueViolation(error)) {
      const existing = await findByIdempotencyKey(userId, idempotencyKey);
      if (existing) return { job: null, rows: [], duplicate: existing };
    }
    throw error;
  });

  if ('duplicate' in created && created.duplicate) return created.duplicate;

  const { job, rows } = created as { job: NonNullable<(typeof created)['job']>; rows: typeof created.rows };

  const queued = await enqueueSends(
    rows.map((row) => ({
      emailRecipientId: row.id,
      emailJobId: job.id,
      userId,
      senderId: sender.id,
      scheduledAt: row.scheduledAt,
      idempotencyKey: row.idempotencyKey,
    })),
  );

  // Index in the background: search must never delay or fail a schedule call.
  indexEmailJobAsync(job.id);

  const last = computeSendTime(
    input.startTime,
    input.recipients.length - 1,
    input.delayBetweenEmails,
    input.hourlyLimit,
  );

  return {
    ...job,
    sender: { id: sender.id, name: sender.name, fromEmail: sender.fromEmail },
    estimatedCompletionAt: last,
    queuedJobs: queued,
    /** True when this response replays an earlier, identical request. */
    deduplicated: false,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** Returns the campaign a previous request with this key already created. */
async function findByIdempotencyKey(userId: string, idempotencyKey: string) {
  const job = await prisma.emailJob.findFirst({
    where: { userId, idempotencyKey },
    include: { sender: { select: { id: true, name: true, fromEmail: true } } },
  });
  if (!job) return null;

  const last = await prisma.emailRecipient.findFirst({
    where: { emailJobId: job.id },
    orderBy: { scheduledAt: 'desc' },
    select: { scheduledAt: true },
  });

  return {
    ...job,
    sender: job.sender,
    estimatedCompletionAt: last?.scheduledAt ?? job.scheduledAt,
    queuedJobs: 0,
    deduplicated: true,
  };
}

/**
 * Cancels a campaign. Delivered and failed rows are history and stay put; only
 * work that has not been attempted is cancelled.
 */
export async function cancelEmailJob(userId: string, id: string) {
  const job = await prisma.emailJob.findFirst({ where: { id, userId } });
  if (!job) throw AppError.notFound('Email campaign not found');

  if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
    throw AppError.conflict(
      ErrorCode.JOB_NOT_CANCELLABLE,
      `This campaign is already ${job.status.toLowerCase()}`,
    );
  }

  // Collect the keys before cancelling so the queued jobs can be removed too.
  const pending = await prisma.emailRecipient.findMany({
    where: { emailJobId: id, status: { in: [...ACTIVE_STATUSES] } },
    select: { idempotencyKey: true },
  });

  const result = await prisma.$transaction(async (tx) => {
    const { count } = await tx.emailRecipient.updateMany({
      where: { emailJobId: id, status: { in: [...ACTIVE_STATUSES] } },
      data: { status: 'CANCELLED' },
    });

    const updated = await tx.emailJob.update({
      where: { id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    return { job: updated, cancelledRecipients: count };
  });

  // Best-effort: a job already running is stopped by the worker's own status
  // check, so a failure to remove it here cannot cause a send.
  const removed = await removeSends(pending.map((row) => row.idempotencyKey));

  // Cancelled rows stay searchable, with their new status.
  indexEmailJobAsync(id);

  return { ...result, removedJobs: removed };
}

export interface FileValidationResult {
  filename: string | null;
  totalLines: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  /** How many of the valid addresses can actually go into one campaign. */
  schedulableCount: number;
  /** True when the list is longer than a single campaign can hold. */
  truncated: boolean;
  maxRecipients: number;
  validEmails: string[];
  invalidEntries: { line: number; value: string; reason: string }[];
}

const EMAIL_RE =
  /^[A-Za-z0-9][A-Za-z0-9_%+-]*(?:\.[A-Za-z0-9_%+-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/** A first row is a header only if a cell is exactly a known column name. */
const HEADER_CELL = /^(e-?mail(\s*address)?|address|recipient|recipients|contact|to|lead)$/i;

/**
 * Parses a CSV/TXT recipient list. Accepts one address per line or a delimited
 * row, and picks the first cell that looks like an email so a header row and
 * extra columns do not break the upload.
 */
export function validateRecipientFile(
  content: string,
  filename?: string,
): FileValidationResult {
  const lines = content.split(/\r?\n/);
  const seen = new Set<string>();
  const validEmails: string[] = [];
  const invalidEntries: FileValidationResult['invalidEntries'] = [];
  let duplicateCount = 0;
  let totalLines = 0;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    totalLines += 1;

    const cells = line.split(/[,;\t]/).map((cell) => cell.trim().replace(/^["']|["']$/g, ''));
    const candidate = cells.find((cell) => cell.includes('@')) ?? cells[0] ?? '';
    const email = candidate.toLowerCase();

    if (!EMAIL_RE.test(email)) {
      // Skip a genuine header row, but never swallow a malformed address:
      // only an exact column name counts as a header.
      if (index === 0 && !line.includes('@') && cells.some((cell) => HEADER_CELL.test(cell))) {
        return;
      }
      if (invalidEntries.length < 100) {
        invalidEntries.push({ line: index + 1, value: candidate.slice(0, 120), reason: 'Not a valid email address' });
      }
      return;
    }

    if (seen.has(email)) {
      duplicateCount += 1;
      return;
    }
    seen.add(email);
    validEmails.push(email);
  });

  // A campaign holds a bounded number of recipients, so a longer list is
  // reported honestly rather than silently trimmed to look like it fits.
  const schedulable = validEmails.slice(0, EMAIL_LIMITS.maxRecipients);

  return {
    filename: filename ?? null,
    totalLines,
    validCount: validEmails.length,
    invalidCount: invalidEntries.length,
    duplicateCount,
    schedulableCount: schedulable.length,
    truncated: validEmails.length > schedulable.length,
    maxRecipients: EMAIL_LIMITS.maxRecipients,
    validEmails: schedulable,
    invalidEntries,
  };
}
