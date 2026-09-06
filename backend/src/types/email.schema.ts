import { z } from 'zod';

/**
 * Request contracts. These are the single source of truth for both runtime
 * validation and the TypeScript types the controllers work with.
 */

export const EMAIL_LIMITS = {
  subjectMax: 200,
  bodyMax: 100_000,
  maxRecipients: 10_000,
  minDelaySeconds: 1,
  maxDelaySeconds: 86_400,
  minHourlyLimit: 1,
  maxHourlyLimit: 2_000,
  maxFileBytes: 5 * 1024 * 1024,
} as const;

/** Stricter than a bare regex: rejects consecutive dots and missing TLDs. */
const emailAddress = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .toLowerCase()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_%+-]*(?:\.[A-Za-z0-9_%+-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/,
    'Not a valid email address',
  );

const cuid = z.string().trim().min(1).max(64);

export const scheduleEmailSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, 'Subject is required')
    .max(EMAIL_LIMITS.subjectMax, `Subject must be ${EMAIL_LIMITS.subjectMax} characters or fewer`),

  body: z
    .string()
    .trim()
    .min(1, 'Body is required')
    .max(EMAIL_LIMITS.bodyMax, 'Body is too large'),

  recipients: z
    .array(emailAddress)
    .min(1, 'At least one recipient is required')
    .max(EMAIL_LIMITS.maxRecipients, `A campaign can hold at most ${EMAIL_LIMITS.maxRecipients} recipients`)
    // Duplicates would be rejected later by the unique constraint; fold them here.
    .transform((list) => [...new Set(list)]),

  startTime: z
    .iso
    .datetime({ offset: true, message: 'startTime must be an ISO 8601 datetime' })
    .transform((value) => new Date(value))
    .refine((date) => date.getTime() > Date.now() - 60_000, {
      message: 'startTime must be in the future',
    }),

  delayBetweenEmails: z
    .number()
    .int('delayBetweenEmails must be a whole number of seconds')
    .min(EMAIL_LIMITS.minDelaySeconds)
    .max(EMAIL_LIMITS.maxDelaySeconds)
    .default(30),

  hourlyLimit: z
    .number()
    .int('hourlyLimit must be a whole number')
    .min(EMAIL_LIMITS.minHourlyLimit)
    .max(EMAIL_LIMITS.maxHourlyLimit)
    .default(100),

  /** Optional: falls back to the user's default sender. */
  senderId: cuid.optional(),
});

export type ScheduleEmailInput = z.infer<typeof scheduleEmailSchema>;

/** Raw CSV/TXT contents to parse and check before scheduling. */
export const validateFileSchema = z.object({
  content: z
    .string()
    .min(1, 'File content is empty')
    .max(EMAIL_LIMITS.maxFileBytes, 'File is larger than 5 MB'),
  filename: z.string().trim().max(255).optional(),
});

export type ValidateFileInput = z.infer<typeof validateFileSchema>;

const RECIPIENT_STATUSES = ['PENDING', 'SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'] as const;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.enum(RECIPIENT_STATUSES).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export const idParamSchema = z.object({ id: cuid });

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'A search term is required').max(200),
  status: z.enum(RECIPIENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
