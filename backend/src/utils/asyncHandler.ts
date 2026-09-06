import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

/**
 * Express 4 does not await handlers, so a rejected promise escapes as an
 * unhandled rejection instead of reaching the error middleware. Wrapping
 * forwards every rejection to `next`, which is what makes the centralized
 * error handler actually central.
 */
export function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}
