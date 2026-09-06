import morgan from 'morgan';
import type { Request, RequestHandler } from 'express';
import { isProduction } from '../config/env.js';

/**
 * Query parameters whose values must never reach a log file. OAuth
 * authorization codes are the important ones: they are short-lived but
 * exchangeable for access tokens, and anyone with log access could redeem one.
 */
const SENSITIVE_PARAMS = new Set([
  'code',
  'state',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'key',
  'secret',
  'password',
  'signature',
]);

/** Rewrites the logged URL so sensitive values become `[redacted]`. */
export function redactUrl(originalUrl: string): string {
  const [path, query] = originalUrl.split('?');
  if (!query) return originalUrl;

  const params = new URLSearchParams(query);
  let changed = false;
  for (const name of [...params.keys()]) {
    if (SENSITIVE_PARAMS.has(name.toLowerCase())) {
      params.set(name, '[redacted]');
      changed = true;
    }
  }
  return changed ? `${path}?${decodeURIComponent(params.toString())}` : originalUrl;
}

morgan.token('safe-url', (req) => redactUrl((req as Request).originalUrl));

/**
 * Request logging with the URL sanitised. The stock `dev` and `combined`
 * formats print `req.originalUrl` verbatim, which writes OAuth codes straight
 * into the log on every callback.
 */
export function requestLogger(): RequestHandler {
  return isProduction
    ? morgan(
        ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version"' +
          ' :status :res[content-length] ":referrer" ":user-agent"',
      )
    : morgan(':method :safe-url :status :response-time ms - :res[content-length]');
}
