import nodemailer, { type Transporter } from 'nodemailer';
import { etherealConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Email delivery, via Ethereal only.
 *
 * Ethereal is a capture-only sandbox: it accepts a message, publishes it at a
 * preview URL, and never delivers to a real inbox. Nothing in this project
 * talks to a production SMTP server, so a stray campaign cannot reach a real
 * person.
 */

/** SMTP settings, either the shared Ethereal account or a sender's own. */
export interface SmtpCredentials {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface OutboundMessage {
  to: string;
  subject: string;
  body: string;
  fromName: string;
  fromEmail: string;
  /** Sender row id — keys the transporter cache. */
  senderId: string;
  /** Per-sender SMTP settings; falls back to the shared account when absent. */
  credentials?: Partial<SmtpCredentials> | null;
}

export interface DeliveryResult {
  messageId: string;
  previewUrl: string | null;
  accepted: string[];
  rejected: string[];
}

/** One transporter per sender, so connections are pooled and reused. */
const transporters = new Map<string, Transporter>();

/** The shared account, provisioned once when ETHEREAL_USER is not set. */
let sharedCredentials: SmtpCredentials | null = null;

async function getSharedCredentials(): Promise<SmtpCredentials> {
  if (sharedCredentials) return sharedCredentials;

  const config = etherealConfig();

  if (config.user && config.password) {
    sharedCredentials = {
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      password: config.password,
    };
    logger.info('Ethereal transport configured from environment', {
      host: config.host,
      user: config.user,
    });
    return sharedCredentials;
  }

  // No credentials supplied — Ethereal hands out throwaway accounts on demand.
  const account = await nodemailer.createTestAccount();
  sharedCredentials = {
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    user: account.user,
    password: account.pass,
  };
  logger.info('Provisioned a throwaway Ethereal account', {
    user: account.user,
    hint: 'set ETHEREAL_USER / ETHEREAL_PASSWORD to keep one account across restarts',
  });
  return sharedCredentials;
}

/**
 * Resolves the transport for one sender. A sender row may carry its own SMTP
 * settings (multiple senders, each with its own mailbox); anything missing
 * falls back to the shared Ethereal account.
 */
async function getTransporter(
  senderId: string,
  overrides?: Partial<SmtpCredentials> | null,
): Promise<Transporter> {
  const cached = transporters.get(senderId);
  if (cached) return cached;

  const shared = await getSharedCredentials();
  const credentials: SmtpCredentials = {
    host: overrides?.host || shared.host,
    port: overrides?.port || shared.port,
    secure: overrides?.secure ?? shared.secure,
    user: overrides?.user || shared.user,
    password: overrides?.password || shared.password,
  };

  const transporter = nodemailer.createTransport({
    host: credentials.host,
    port: credentials.port,
    secure: credentials.secure,
    auth: { user: credentials.user, pass: credentials.password },
    pool: true,
    maxConnections: 3,
  });

  transporters.set(senderId, transporter);
  logger.debug('Created SMTP transporter', {
    senderId,
    host: credentials.host,
    usingSenderCredentials: Boolean(overrides?.user),
  });
  return transporter;
}

export async function sendEmail(message: OutboundMessage): Promise<DeliveryResult> {
  const transporter = await getTransporter(message.senderId, message.credentials);

  const info = await transporter.sendMail({
    from: `"${message.fromName}" <${message.fromEmail}>`,
    to: message.to,
    subject: message.subject,
    text: message.body,
  });

  const preview = nodemailer.getTestMessageUrl(info);

  return {
    messageId: info.messageId,
    previewUrl: typeof preview === 'string' ? preview : null,
    accepted: (info.accepted ?? []).map(String),
    rejected: (info.rejected ?? []).map(String),
  };
}

/** Confirms the SMTP connection works, for health checks and diagnostics. */
export async function verifyTransport(senderId = 'shared'): Promise<boolean> {
  const transporter = await getTransporter(senderId);
  await transporter.verify();
  return true;
}

export function describeTransport(): string {
  return sharedCredentials ? `ethereal (${sharedCredentials.user})` : 'ethereal (not yet connected)';
}

export function closeMailer(): void {
  for (const transporter of transporters.values()) transporter.close();
  transporters.clear();
  sharedCredentials = null;
}
