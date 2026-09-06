import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCode } from '../types/api.js';
import { AppError } from '../utils/AppError.js';
import { sendError } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';

/** Prisma known-request errors carry a `code` like P2002 (unique violation). */
function prismaCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null;
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, ErrorCode.NOT_FOUND, `No route matches ${req.method} ${req.originalUrl}`);
}

/**
 * Single exit point for every failure in the API. Known errors keep their
 * meaning; anything else is logged in full and reported as a generic 500 so
 * internals never reach the client.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (err instanceof AppError) {
    sendError(res, err.status, err.code, err.message, err.details);
    return;
  }

  // A schema parsed outside the validate() middleware.
  if (err instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.length > 0 ? issue.path.join('.') : '_';
      (details[key] ??= []).push(issue.message);
    }
    sendError(res, 400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', details);
    return;
  }

  const pCode = prismaCode(err);
  if (pCode === 'P2002') {
    sendError(res, 409, ErrorCode.CONFLICT, 'That record already exists');
    return;
  }
  if (pCode === 'P2025') {
    sendError(res, 404, ErrorCode.NOT_FOUND, 'Resource not found');
    return;
  }
  if (pCode === 'P2003') {
    sendError(res, 400, ErrorCode.VALIDATION_ERROR, 'Referenced record does not exist');
    return;
  }

  // body-parser failures carry a `type` and an HTTP status of their own.
  const bodyParserType =
    typeof err === 'object' && err !== null ? (err as { type?: unknown }).type : undefined;

  if (bodyParserType === 'entity.too.large') {
    sendError(res, 413, ErrorCode.VALIDATION_ERROR, 'Request body is too large');
    return;
  }
  if (bodyParserType === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
    sendError(res, 400, ErrorCode.VALIDATION_ERROR, 'Request body is not valid JSON');
    return;
  }

  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, err);
  sendError(res, 500, ErrorCode.INTERNAL_ERROR, 'Something went wrong on our side');
}
