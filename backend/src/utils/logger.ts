import { isProduction } from '../config/env.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

/** Structured fields attached to a log line. */
export type LogContext = Record<string, unknown>;

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVEL_ORDER[(process.env.LOG_LEVEL as Level) || (isProduction ? 'info' : 'debug')] ?? 20;

/** Errors carry no enumerable properties, so unpack them explicitly. */
function normalise(context?: unknown): LogContext {
  if (context === undefined || context === null) return {};
  if (context instanceof Error) {
    return { error: context.message, errorName: context.name };
  }
  if (typeof context === 'object' && !Array.isArray(context)) {
    return context as LogContext;
  }
  return { detail: context };
}

function format(value: unknown): string {
  if (typeof value === 'string') return value.includes(' ') ? JSON.stringify(value) : value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

function emit(level: Level, message: string, context?: unknown): void {
  if (LEVEL_ORDER[level] < MIN_LEVEL) return;

  const fields = normalise(context);
  const timestamp = new Date().toISOString();

  if (isProduction) {
    // One JSON object per line, for a log aggregator to parse.
    console[level === 'debug' ? 'log' : level](
      JSON.stringify({ timestamp, level, message, ...fields }),
    );
    return;
  }

  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}=${format(value)}`)
    .join(' ');

  console[level === 'debug' ? 'log' : level](
    `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${suffix ? ' ' + suffix : ''}`,
  );
}

export const logger = {
  debug: (message: string, context?: unknown) => emit('debug', message, context),
  info: (message: string, context?: unknown) => emit('info', message, context),
  warn: (message: string, context?: unknown) => emit('warn', message, context),
  error: (message: string, context?: unknown) => emit('error', message, context),
};
