import { randomBytes } from 'node:crypto';
import { slackConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Slack OAuth v2 and messaging.
 *
 * The client secret is used only here, server-side, in the token exchange. It
 * is never sent to the browser and never logged — nor are authorization codes
 * or access tokens.
 */

const AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const ACCESS_URL = 'https://slack.com/api/oauth.v2.access';
const POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';

export interface SlackInstallation {
  teamId: string;
  teamName: string;
  botUserId: string | null;
  authedUserId: string | null;
  accessToken: string;
  scope: string | null;
  channelId: string | null;
  channelName: string | null;
  webhookUrl: string | null;
}

export function createOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

export function buildInstallUrl(state: string): string {
  const { clientId, redirectUri, scopes } = slackConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface OAuthAccessResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  scope?: string;
  bot_user_id?: string;
  team?: { id?: string; name?: string };
  authed_user?: { id?: string };
  incoming_webhook?: { url?: string; channel?: string; channel_id?: string };
}

/**
 * Exchanges the one-time code for a workspace token. Slack returns HTTP 200
 * even for failures, so the `ok` flag is what actually decides.
 */
export async function exchangeCode(code: string): Promise<SlackInstallation> {
  const { clientId, clientSecret, redirectUri } = slackConfig();

  const response = await fetch(ACCESS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const payload = (await response.json()) as OAuthAccessResponse;

  if (!payload.ok || !payload.access_token || !payload.team?.id) {
    // Log the error code only — never the code or any token.
    logger.warn('Slack token exchange rejected', { slackError: payload.error ?? 'unknown' });
    throw new Error(payload.error ?? 'slack_oauth_failed');
  }

  return {
    teamId: payload.team.id,
    teamName: payload.team.name ?? 'Slack workspace',
    botUserId: payload.bot_user_id ?? null,
    authedUserId: payload.authed_user?.id ?? null,
    accessToken: payload.access_token,
    scope: payload.scope ?? null,
    channelId: payload.incoming_webhook?.channel_id ?? null,
    channelName: payload.incoming_webhook?.channel ?? null,
    webhookUrl: payload.incoming_webhook?.url ?? null,
  };
}

export interface SlackDeliveryTarget {
  webhookUrl?: string | null;
  accessToken?: string | null;
  channelId?: string | null;
}

/**
 * Posts a message. Prefers the incoming webhook, which is bound to the channel
 * the installer chose and needs no channel membership; falls back to
 * chat.postMessage with the bot token.
 */
export async function postMessage(
  target: SlackDeliveryTarget,
  text: string,
): Promise<{ delivered: boolean; via: 'webhook' | 'chat.postMessage' | 'none'; error?: string }> {
  if (target.webhookUrl) {
    const response = await fetch(target.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (response.ok) return { delivered: true, via: 'webhook' };
    return { delivered: false, via: 'webhook', error: `HTTP ${response.status}` };
  }

  if (target.accessToken && target.channelId) {
    const response = await fetch(POST_MESSAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${target.accessToken}`,
      },
      body: JSON.stringify({ channel: target.channelId, text }),
    });
    const payload = (await response.json()) as { ok: boolean; error?: string };
    return payload.ok
      ? { delivered: true, via: 'chat.postMessage' }
      : { delivered: false, via: 'chat.postMessage', error: payload.error };
  }

  return { delivered: false, via: 'none', error: 'no_delivery_target' };
}
