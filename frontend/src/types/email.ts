/** Lifecycle of a single email in the scheduling pipeline. */
export type EmailStatus =
  | 'PENDING'
  | 'SCHEDULED'
  | 'PROCESSING'
  | 'SENT'
  | 'FAILED'
  | 'CANCELLED';

/** The campaign an email belongs to, as embedded in list responses. */
export interface EmailJobSummary {
  id: string;
  subject: string;
}

/** One recipient row, exactly as the list endpoints return it. */
export interface Email {
  id: string;
  email: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  errorMessage: string | null;
  attempts: number;
  providerMessageId: string | null;
  /** Ethereal capture link, present once delivered. */
  previewUrl: string | null;
  emailJob: EmailJobSummary;
}

/** `GET /emails/scheduled` — still queued. */
export type ScheduledEmail = Email;
/** `GET /emails/sent` — delivered or permanently failed. */
export type SentEmail = Email;

/** `GET /emails/search` returns a flattened document, not a recipient row. */
export interface EmailSearchHit {
  recipientId: string;
  emailJobId: string;
  userId: string;
  senderId: string;
  email: string;
  subject: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  score: number;
}

/** Payload accepted by `POST /emails/schedule`. */
export interface ScheduleRequest {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayBetweenEmails: number;
  hourlyLimit: number;
  senderId?: string;
}

/** What the schedule endpoint gives back. */
export interface ScheduleResult {
  id: string;
  subject: string;
  status: EmailStatus | 'DRAFT';
  totalRecipients: number;
  scheduledAt: string;
  estimatedCompletionAt: string;
  queuedJobs: number;
  /** True when the API replayed an earlier identical request. */
  deduplicated: boolean;
  sender: { id: string; name: string; fromEmail: string };
}

/** Compose form state — recipients live separately until the file is parsed. */
export type ComposeFormValues = Omit<ScheduleRequest, 'recipients' | 'senderId'>;

export interface InvalidRecipientEntry {
  line: number;
  value: string;
  reason: string;
}

export interface RecipientFileReport {
  filename: string | null;
  totalLines: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  schedulableCount: number;
  truncated: boolean;
  maxRecipients: number;
  validEmails: string[];
  invalidEntries: InvalidRecipientEntry[];
}

export interface RecipientFile extends RecipientFileReport {
  name: string;
  size: number;
}

export type QueueState = 'healthy' | 'degraded' | 'paused';

export interface QueueSnapshot {
  state: QueueState;
  active: number;
  waiting: number;
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
