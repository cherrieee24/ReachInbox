import type { NextFunction, Request, Response } from 'express';
import { findUserById } from '../services/auth.service.js';
import { AppError } from '../utils/AppError.js';
import { SESSION_COOKIE, clearSessionCookie } from '../utils/cookies.js';
import { verifySessionToken } from '../utils/jwt.js';

/**
 * Verifies the session cookie and attaches the user. Every failure mode —
 * missing, tampered, expired, or pointing at a deleted user — produces a 401,
 * so the client has one signal to react to.
 *
 * Downstream code must read identity from `req.user` and never from input.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;

  if (!token) {
    next(AppError.unauthorized('Not authenticated'));
    return;
  }

  const claims = verifySessionToken(token);
  if (!claims) {
    clearSessionCookie(res);
    next(AppError.unauthorized('Session expired'));
    return;
  }

  try {
    const user = await findUserById(claims.sub);
    if (!user) {
      clearSessionCookie(res);
      next(AppError.unauthorized('Session no longer valid'));
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
