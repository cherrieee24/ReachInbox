import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { env, isSlackConfigured } from '../config/env.js';
import { buildInstallUrl, createOAuthState, exchangeCode } from '../integrations/slack.js';
import * as slackService from '../services/slack.service.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  SLACK_STATE_COOKIE,
  clearSlackStateCookie,
  setSlackStateCookie,
} from '../utils/cookies.js';
import { logger } from '../utils/logger.js';

function currentUserId(req: Request): string {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function finish(res: Response, outcome: string): void {
  clearSlackStateCookie(res);
  res.redirect(`${env.frontendUrl}/settings?slack=${encodeURIComponent(outcome)}`);
}

/**
 * Step 1 — send the browser to Slack.
 *
 * The state cookie binds the callback to the session that started it, and the
 * user id is carried in the state so the callback knows whose connection this
 * is even though Slack sends the browser back on a fresh request.
 */
export function connect(req: Request, res: Response): void {
  const userId = currentUserId(req);

  if (!isSlackConfigured()) {
    finish(res, 'not_configured');
    return;
  }

  const nonce = createOAuthState();
  const state = `${userId}.${nonce}`;
  setSlackStateCookie(res, state);
  res.redirect(buildInstallUrl(state));
}

/** Step 2 — Slack redirects back with a one-time code. */
export async function callback(req: Request, res: Response): Promise<void> {
  const { code, state, error } = req.query;

  if (typeof error === 'string' && error) {
    logger.warn('Slack returned an OAuth error', { slackError: error });
    finish(res, error === 'access_denied' ? 'access_denied' : 'failed');
    return;
  }

  const expected = req.cookies?.[SLACK_STATE_COOKIE] as string | undefined;
  if (typeof state !== 'string' || !expected || !safeEquals(state, expected)) {
    logger.warn('Rejected Slack callback with a mismatched state');
    finish(res, 'invalid_state');
    return;
  }

  const userId = state.split('.')[0];
  if (!userId) {
    finish(res, 'invalid_state');
    return;
  }

  if (typeof code !== 'string' || !code) {
    finish(res, 'missing_code');
    return;
  }

  try {
    // The code is exchanged server-side; it is never logged or echoed back.
    const installation = await exchangeCode(code);
    await slackService.saveInstallation(userId, installation);
    finish(res, 'connected');
  } catch {
    finish(res, 'failed');
  }
}

export async function status(req: Request, res: Response): Promise<void> {
  const result = await slackService.getStatus(currentUserId(req));
  sendSuccess(res, { ...result, configured: isSlackConfigured() });
}

export async function disconnect(req: Request, res: Response): Promise<void> {
  const result = await slackService.disconnect(currentUserId(req));
  sendSuccess(res, result, {
    message: result.disconnected > 0 ? 'Slack disconnected' : 'No active Slack connection',
  });
}
