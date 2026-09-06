import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import {
  buildAuthUrl,
  createOAuthState,
  exchangeCodeForProfile,
} from '../integrations/google.js';
import { findOrCreateUserFromGoogle } from '../services/auth.service.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  OAUTH_STATE_COOKIE,
  clearOAuthStateCookie,
  clearSessionCookie,
  setOAuthStateCookie,
  setSessionCookie,
} from '../utils/cookies.js';
import { signSessionToken } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function failureRedirect(res: Response, reason: string): void {
  clearOAuthStateCookie(res);
  res.redirect(`${env.frontendUrl}/login?error=${encodeURIComponent(reason)}`);
}

/** Step 1: start the OAuth flow by sending the browser to Google. */
export function startGoogleAuth(_req: Request, res: Response): void {
  try {
    const state = createOAuthState();
    setOAuthStateCookie(res, state);
    res.redirect(buildAuthUrl(state));
  } catch (error) {
    logger.error('Failed to start Google OAuth', error);
    failureRedirect(res, 'oauth_unavailable');
  }
}

/**
 * Step 2: Google redirects back here with a one-time code. The code is
 * exchanged server-side, so the client secret and the tokens never touch the
 * browser — only the resulting session cookie does.
 */
export async function handleGoogleCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error } = req.query;

  if (typeof error === 'string' && error) {
    logger.warn('Google returned an OAuth error', { error });
    failureRedirect(res, error === 'access_denied' ? 'access_denied' : 'oauth_failed');
    return;
  }

  const expectedState = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
  if (typeof state !== 'string' || !expectedState || !safeEquals(state, expectedState)) {
    logger.warn('Rejected OAuth callback with a mismatched state');
    failureRedirect(res, 'invalid_state');
    return;
  }

  if (typeof code !== 'string' || !code) {
    failureRedirect(res, 'missing_code');
    return;
  }

  try {
    const profile = await exchangeCodeForProfile(code);
    const user = await findOrCreateUserFromGoogle(profile);

    clearOAuthStateCookie(res);
    setSessionCookie(res, signSessionToken({ sub: user.id, email: user.email }));

    logger.info('Signed in via Google', { userId: user.id });
    res.redirect(`${env.frontendUrl}/dashboard`);
  } catch (err) {
    logger.error('Google OAuth callback failed', err);
    failureRedirect(res, 'oauth_failed');
  }
}

/** Returns the signed-in user. requireAuth has already validated the session. */
export function getCurrentUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    next(AppError.unauthorized());
    return;
  }
  sendSuccess(res, req.user);
}

export function logout(_req: Request, res: Response): void {
  clearSessionCookie(res);
  sendSuccess(res, null, { message: 'Signed out' });
}
