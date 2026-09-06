import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

/**
 * Authorization layer on top of `requireAuth`. Must always be mounted after
 * it — it reads the role from `req.user`, which only requireAuth populates.
 *
 * Returns 403 rather than 404 here: unlike a campaign, the existence of the
 * admin dashboard is not a secret, and a signed-in user deserves to be told
 * they lack access rather than being shown a confusing not-found.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(AppError.unauthorized());
    return;
  }

  if (req.user.role !== 'ADMIN') {
    logger.warn('Blocked non-admin from an admin route', {
      userId: req.user.id,
      path: req.originalUrl,
    });
    next(AppError.forbidden('Administrator access is required for this page'));
    return;
  }

  next();
}
