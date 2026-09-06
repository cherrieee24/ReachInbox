import { prisma } from '../config/prisma.js';
import {
  postMessage,
  type SlackInstallation,
} from '../integrations/slack.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

/**
 * Slack connections, scoped per user.
 *
 * Tokens and webhook URLs are encrypted before they touch the database and
 * decrypted only at the moment of sending. Nothing here ever logs a token, a
 * webhook URL or an OAuth code.
 */

export interface SlackStatus {
  connected: boolean;
  teamId?: string;
  teamName?: string;
  channelName?: string | null;
  scope?: string | null;
  connectedAt?: string;
}

/** Creates or refreshes the connection for this user and workspace. */
export async function saveInstallation(
  userId: string,
  installation: SlackInstallation,
): Promise<void> {
  const data = {
    teamName: installation.teamName,
    botUserId: installation.botUserId,
    authedUserId: installation.authedUserId,
    channelId: installation.channelId,
    channelName: installation.channelName,
    accessToken: encryptSecret(installation.accessToken),
    webhookUrl: installation.webhookUrl ? encryptSecret(installation.webhookUrl) : null,
    scope: installation.scope,
    status: 'ACTIVE' as const,
    connectedAt: new Date(),
    revokedAt: null,
  };

  // Reconnecting the same workspace updates in place rather than duplicating.
  await prisma.slackConnection.upsert({
    where: { userId_teamId: { userId, teamId: installation.teamId } },
    create: { userId, teamId: installation.teamId, ...data },
    update: data,
  });

  logger.info('Slack connection saved', {
    userId,
    teamId: installation.teamId,
    teamName: installation.teamName,
    channel: installation.channelName,
    hasWebhook: Boolean(installation.webhookUrl),
  });
}

export async function getStatus(userId: string): Promise<SlackStatus> {
  const connection = await prisma.slackConnection.findFirst({
    where: { userId, status: 'ACTIVE' },
    orderBy: { connectedAt: 'desc' },
  });

  if (!connection) return { connected: false };

  return {
    connected: true,
    teamId: connection.teamId,
    teamName: connection.teamName,
    channelName: connection.channelName,
    scope: connection.scope,
    connectedAt: connection.connectedAt.toISOString(),
  };
}

/**
 * Marks the connection revoked rather than deleting it, so the audit trail of
 * who connected what survives a disconnect.
 */
export async function disconnect(userId: string): Promise<{ disconnected: number }> {
  const { count } = await prisma.slackConnection.updateMany({
    where: { userId, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });

  logger.info('Slack disconnected', { userId, connections: count });
  return { disconnected: count };
}

/**
 * Sends a notification to a user's Slack, if they have one connected.
 *
 * Never throws. A missing connection, a revoked token or a Slack outage all
 * resolve to `false` — notifications are a courtesy and must never take down
 * the caller, which in practice is the send worker.
 */
export async function notify(userId: string, text: string): Promise<boolean> {
  try {
    const connection = await prisma.slackConnection.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { connectedAt: 'desc' },
    });

    if (!connection) {
      logger.debug('Slack notification skipped: not connected', { userId });
      return false;
    }

    const result = await postMessage(
      {
        webhookUrl: connection.webhookUrl ? decryptSecret(connection.webhookUrl) : null,
        accessToken: decryptSecret(connection.accessToken),
        channelId: connection.channelId,
      },
      text,
    );

    if (!result.delivered) {
      logger.warn('Slack notification failed', {
        userId,
        teamId: connection.teamId,
        via: result.via,
        slackError: result.error,
      });

      // Slack tells us when an install has been removed; stop retrying it.
      if (result.error === 'token_revoked' || result.error === 'account_inactive') {
        await prisma.slackConnection.update({
          where: { id: connection.id },
          data: { status: 'REVOKED', revokedAt: new Date() },
        });
      }
      return false;
    }

    logger.info('Slack notification delivered', {
      userId,
      teamId: connection.teamId,
      via: result.via,
    });
    return true;
  } catch (error) {
    logger.warn('Slack notification error', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Fire-and-forget wrapper for hot paths such as the worker. */
export function notifyAsync(userId: string, text: string): void {
  void notify(userId, text).catch(() => undefined);
}
