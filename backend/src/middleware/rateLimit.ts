import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { ErrorCode } from '../types/api.js';
import { sendError } from '../utils/apiResponse.js';

/**
 * HTTP request throttling.
 *
 * Separate from the email rate limiter — that one protects sender reputation,
 * this one protects the server. Limits are per authenticated user where a
 * session exists, and per IP otherwise, so one noisy account cannot exhaust
 * the budget for everyone behind a shared address.
 */
function keyFor(req: Request): string {
  if (req.user?.id) return `user:${req.user.id}`;
  // `ipKeyGenerator` collapses an IPv6 address to its /64 prefix. Keying on
  // the raw address would let anyone with an IPv6 allocation — which is most
  // hosting providers — get a fresh budget per request.
  return `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

function onLimited(_req: Request, res: Response): void {
  sendError(res, 429, ErrorCode.RATE_LIMITED, 'Too many requests. Slow down and try again shortly.');
}

const shared = {
  standardHeaders: true as const,
  legacyHeaders: false as const,
  keyGenerator: keyFor,
  handler: onLimited,
};

/** Broad ceiling for ordinary reads and writes. */
export function apiLimiter(): RateLimitRequestHandler {
  return rateLimit({
    ...shared,
    windowMs: 60_000,
    limit: Number(process.env.RATE_LIMIT_API_PER_MINUTE ?? 300),
  });
}

/**
 * Tighter budget for the endpoints worth abusing: sign-in attempts and the
 * two routes that do real work per request (parsing a 5 MB recipient list,
 * writing thousands of rows).
 */
export function sensitiveLimiter(perMinute: number, envVar?: string): RateLimitRequestHandler {
  return rateLimit({
    ...shared,
    windowMs: 60_000,
    limit: Number((envVar && process.env[envVar]) ?? perMinute),
  });
}
