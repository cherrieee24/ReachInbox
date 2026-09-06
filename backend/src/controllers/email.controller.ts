import type { Request, Response } from 'express';
import type {
  ListQuery,
  ScheduleEmailInput,
  SearchQuery,
  ValidateFileInput,
} from '../types/email.schema.js';
import * as emailService from '../services/email.service.js';
import { searchEmails } from '../services/search.service.js';
import { createHash } from 'node:crypto';
import { AppError } from '../utils/AppError.js';
import { buildPagination, sendSuccess } from '../utils/apiResponse.js';

/**
 * The authenticated user is the only source of identity. A `userId` in the
 * body or query is ignored entirely — it never reaches the service layer.
 *
 * Handlers throw freely: asyncHandler forwards rejections to the error
 * middleware, so there is no try/catch noise here.
 */
function currentUserId(req: Request): string {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

export async function getScheduled(req: Request, res: Response): Promise<void> {
  const query = req.validatedQuery as ListQuery;
  const { items, totalItems } = await emailService.listScheduled(currentUserId(req), query);
  sendSuccess(res, items, { meta: buildPagination(query.page, query.pageSize, totalItems) });
}

export async function getSent(req: Request, res: Response): Promise<void> {
  const query = req.validatedQuery as ListQuery;
  const { items, totalItems } = await emailService.listSent(currentUserId(req), query);
  sendSuccess(res, items, { meta: buildPagination(query.page, query.pageSize, totalItems) });
}

/**
 * Full-text search over the caller's emails. The user id comes from the
 * session, so a search can never reach another user's data.
 */
export async function search(req: Request, res: Response): Promise<void> {
  const query = req.validatedQuery as SearchQuery;
  const outcome = await searchEmails({
    userId: currentUserId(req),
    query: query.q,
    status: query.status,
    page: query.page,
    pageSize: query.pageSize,
  });

  sendSuccess(res, outcome.hits, {
    meta: buildPagination(query.page, query.pageSize, outcome.total),
    ...(outcome.source === 'database'
      ? { message: 'Search index unavailable — results served from the database' }
      : {}),
  });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const { id } = req.validatedParams as { id: string };
  sendSuccess(res, await emailService.getEmailJob(currentUserId(req), id));
}

/**
 * Idempotency key for a scheduling request.
 *
 * An explicit `Idempotency-Key` header is authoritative — that is the client
 * saying "these two requests are the same operation". Without one, a
 * fingerprint of the payload plus a one-minute bucket is used, which catches
 * an accidental double submit while still allowing the same campaign to be
 * sent again deliberately a minute later.
 */
function idempotencyKeyFor(req: Request, input: ScheduleEmailInput): string {
  const header = req.get('Idempotency-Key');
  if (header && header.trim()) return `hdr:${header.trim().slice(0, 128)}`;

  const bucket = Math.floor(Date.now() / 60_000);
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        subject: input.subject,
        body: input.body,
        recipients: input.recipients,
        startTime: input.startTime,
        bucket,
      }),
    )
    .digest('hex')
    .slice(0, 40);
  return `auto:${fingerprint}`;
}

export async function schedule(req: Request, res: Response): Promise<void> {
  const input = req.body as ScheduleEmailInput;
  const job = await emailService.scheduleEmails(
    currentUserId(req),
    input,
    idempotencyKeyFor(req, input),
  );

  // A replay is not a creation, so it answers 200 rather than 201.
  sendSuccess(res, job, {
    status: job.deduplicated ? 200 : 201,
    message: job.deduplicated
      ? 'This request was already processed — returning the existing campaign.'
      : `Scheduled ${input.recipients.length} email(s). Delivery starts once the queue worker is running.`,
  });
}

export function validateFile(req: Request, res: Response): void {
  currentUserId(req);
  const { content, filename } = req.body as ValidateFileInput;
  const result = emailService.validateRecipientFile(content, filename);
  sendSuccess(res, result, { message: `${result.validCount} valid address(es) found` });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const { id } = req.validatedParams as { id: string };
  const result = await emailService.cancelEmailJob(currentUserId(req), id);
  sendSuccess(res, result, {
    message: `Campaign cancelled. ${result.cancelledRecipients} pending email(s) will not be sent.`,
  });
}
