import type { CookieOptions, Response } from 'express';
import { authConfig, isProduction } from '../config/env.js';

export const SESSION_COOKIE = 'reachinbox_session';
export const OAUTH_STATE_COOKIE = 'reachinbox_oauth_state';
export const SLACK_STATE_COOKIE = 'reachinbox_slack_state';

/**
 * The session lives in an httpOnly cookie so the token is never readable from
 * JavaScript. SameSite defaults to Lax, which still allows the top-level OAuth
 * callback redirect to carry it while blocking cross-site POSTs.
 *
 * Deployments that put the SPA and the API on unrelated domains must set
 * COOKIE_SAMESITE=none, since a Lax cookie is not sent on cross-site XHR at
 * all. `none` is meaningless without Secure, so it is paired with it here and
 * rejected outside production by `authConfig()`.
 */
function baseOptions(): CookieOptions {
  const { cookieDomain, cookieSameSite } = authConfig();
  return {
    httpOnly: true,
    secure: isProduction || cookieSameSite === 'none',
    sameSite: cookieSameSite,
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
}

export function setSessionCookie(res: Response, token: string): void {
  const { sessionTtlSeconds } = authConfig();
  res.cookie(SESSION_COOKIE, token, {
    ...baseOptions(),
    maxAge: sessionTtlSeconds * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, baseOptions());
}

/** Short-lived cookie holding the CSRF state for one OAuth round trip. */
export function setOAuthStateCookie(res: Response, state: string): void {
  res.cookie(OAUTH_STATE_COOKIE, state, {
    ...baseOptions(),
    maxAge: 10 * 60 * 1000,
  });
}

export function clearOAuthStateCookie(res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE, baseOptions());
}

/** Same short-lived CSRF pattern, for the Slack install round trip. */
export function setSlackStateCookie(res: Response, state: string): void {
  res.cookie(SLACK_STATE_COOKIE, state, { ...baseOptions(), maxAge: 10 * 60 * 1000 });
}

export function clearSlackStateCookie(res: Response): void {
  res.clearCookie(SLACK_STATE_COOKIE, baseOptions());
}
