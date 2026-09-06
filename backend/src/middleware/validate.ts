import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { AppError } from '../utils/AppError.js';

type Source = 'body' | 'query' | 'params';

/** Turns a ZodError into `{ field: [messages] }` for the error envelope. */
function toDetails(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

/**
 * Parses one part of the request and replaces it with the parsed value, so
 * controllers receive coerced, defaulted, fully typed data.
 *
 * Express 5 makes `req.query` a getter, so parsed query lands on
 * `req.validatedQuery` instead of being assigned back.
 */
export function validate<TSchema extends ZodType>(schema: TSchema, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      next(AppError.badRequest('Request validation failed', toDetails(result.error)));
      return;
    }

    if (source === 'query') {
      req.validatedQuery = result.data;
    } else if (source === 'params') {
      req.validatedParams = result.data;
    } else {
      req.body = result.data;
    }
    next();
  };
}
