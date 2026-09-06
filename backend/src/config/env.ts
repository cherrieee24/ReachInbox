import dotenv from 'dotenv';

dotenv.config();

/**
 * Central place for reading process.env. Nothing else in the codebase should
 * touch process.env directly — import from here instead.
 *
 * Secrets live only in the environment: none of them are ever committed, and
 * none of them are exposed to the browser.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value : fallback;
}

const nodeEnv = optional('NODE_ENV', 'development');
const isProd = nodeEnv === 'production';

/**
 * Localhost defaults are a convenience for development and a trap in
 * production: the server would boot healthy while every browser request was
 * CORS-blocked, with nothing in the logs pointing at the cause. In production
 * these must be set explicitly.
 */
function requiredInProduction(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.trim()) return value;
  if (isProd) {
    throw new Error(
      `Missing required environment variable ${name}. It has no safe default in production.`,
    );
  }
  return devFallback;
}

export const env = {
  nodeEnv,
  port: Number(optional('PORT', '4000')),
  /** Where the SPA is served from — used for CORS and post-login redirects. */
  frontendUrl: requiredInProduction('FRONTEND_URL', 'http://localhost:5173').replace(/\/+$/, ''),
  corsOrigin: requiredInProduction('CORS_ORIGIN', 'http://localhost:5173'),
  databaseUrl: requiredInProduction('DATABASE_URL', ''),
} as const;

export const isProduction = isProd;

/**
 * Serving the built SPA from this process puts the API and the app on one
 * origin, which sidesteps both the CORS allowlist and the cross-site cookie
 * problem. Off by default: hosting the SPA on a CDN is the better shape when
 * the two share a parent domain.
 */
export function staticConfig() {
  return {
    enabled: optional('SERVE_FRONTEND', 'false') === 'true',
    distPath: optional('FRONTEND_DIST_PATH', '../frontend/dist'),
  };
}

/**
 * Auth configuration is read lazily so the server can boot (and serve /health)
 * with an incomplete .env, failing loudly only when a login is attempted.
 */
export function authConfig() {
  return {
    jwtSecret: required('JWT_SECRET'),
    sessionTtlSeconds: Number(optional('SESSION_TTL_SECONDS', String(60 * 60 * 24 * 7))),
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
    cookieSameSite: cookieSameSite(),
  };
}

export type SameSite = 'lax' | 'strict' | 'none';

/**
 * `lax` is right whenever the SPA and the API share a registrable domain
 * (app.example.com + api.example.com), and it is what the OAuth callback
 * redirect needs. Hosting them on unrelated domains — a CDN and a PaaS —
 * makes every API call cross-site, and only `none` survives that.
 *
 * `none` requires the Secure attribute, which requires HTTPS. Rejecting the
 * combination here turns a silent "login succeeds then everything 401s" into
 * a boot-time error naming the cause.
 */
function cookieSameSite(): SameSite {
  const value = optional('COOKIE_SAMESITE', 'lax').toLowerCase();
  if (value !== 'lax' && value !== 'strict' && value !== 'none') {
    throw new Error(`COOKIE_SAMESITE must be one of lax, strict, none — got "${value}".`);
  }
  if (value === 'none' && !isProd) {
    throw new Error(
      'COOKIE_SAMESITE=none requires Secure cookies, which this server only sets when ' +
        'NODE_ENV=production. Use lax in development.',
    );
  }
  return value;
}

export function googleConfig() {
  return {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    callbackUrl: optional(
      'GOOGLE_CALLBACK_URL',
      `http://localhost:${optional('PORT', '4000')}/api/auth/google/callback`,
    ),
  };
}

export function databaseUrl(): string {
  return required('DATABASE_URL');
}

/**
 * Key for encrypting secrets at rest. Required the moment anything sensitive
 * is stored, so it fails loudly rather than silently writing plaintext.
 */
export function encryptionKey(): string {
  return required('ENCRYPTION_KEY');
}

/**
 * Emails promoted to ADMIN on sign-in. This is the bootstrap for the very
 * first administrator — after that, roles live in the database.
 */
export function adminEmails(): string[] {
  return optional('ADMIN_EMAILS', '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function slackConfig() {
  return {
    clientId: required('SLACK_CLIENT_ID'),
    clientSecret: required('SLACK_CLIENT_SECRET'),
    redirectUri: optional(
      'SLACK_REDIRECT_URI',
      `http://localhost:${optional('PORT', '4000')}/api/slack/callback`,
    ),
    /** incoming-webhook gives a channel the user picks during install. */
    scopes: optional('SLACK_SCOPES', 'incoming-webhook,chat:write'),
  };
}

/** True when Slack credentials are present, without throwing if they are not. */
export function isSlackConfigured(): boolean {
  return Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);
}

/** Elasticsearch is the search index — never a source of truth. */
export function searchConfig() {
  return {
    node: optional('ELASTICSEARCH_NODE', 'http://localhost:9200'),
    index: optional('ELASTICSEARCH_INDEX', 'reachinbox-emails'),
    /** How long to stop calling Elasticsearch after it fails. */
    cooldownMs: Math.max(1000, Number(optional('ELASTICSEARCH_COOLDOWN_MS', '15000'))),
    requestTimeoutMs: Math.max(500, Number(optional('ELASTICSEARCH_TIMEOUT_MS', '3000'))),
    username: process.env.ELASTICSEARCH_USERNAME ?? '',
    password: process.env.ELASTICSEARCH_PASSWORD ?? '',
  };
}

/** Redis is the queue's backing store — never a source of truth. */
export function redisConfig() {
  return {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
  };
}

/**
 * Worker tuning. Every value is environment-driven so throughput can be
 * changed per deployment without a code change.
 */
export function workerConfig() {
  return {
    enabled: optional('WORKER_ENABLED', 'true') !== 'false',
    concurrency: Math.max(1, Number(optional('WORKER_CONCURRENCY', '5'))),
    /**
     * Minimum spacing between two sends from the same sender. Enforced in
     * Redis, so it holds across every worker and every backend instance.
     */
    minDelayMs: Math.max(
      0,
      Number(optional('MIN_EMAIL_DELAY_MS', optional('EMAIL_MIN_DELAY_MS', '1000'))),
    ),
    /**
     * Ceiling on sends per sender per rolling hour window. A campaign's own
     * `hourlyLimit` may be lower; the smaller of the two always wins.
     */
    maxEmailsPerHour: Math.max(1, Number(optional('MAX_EMAILS_PER_HOUR', '100'))),
    attempts: Math.max(1, Number(optional('EMAIL_JOB_ATTEMPTS', '3'))),
    backoffMs: Math.max(1000, Number(optional('EMAIL_JOB_BACKOFF_MS', '30000'))),
    /** Completed/failed jobs kept in Redis for inspection. */
    keepCompleted: Number(optional('EMAIL_JOB_KEEP_COMPLETED', '1000')),
    keepFailed: Number(optional('EMAIL_JOB_KEEP_FAILED', '5000')),
  };
}

/**
 * Ethereal is the only transport this project uses. It is a capture-only
 * sandbox: it accepts mail, shows it on a preview page, and never delivers to
 * a real inbox. Credentials come from the environment; leaving them blank
 * provisions a throwaway account at startup.
 */
export function etherealConfig() {
  return {
    host: optional('ETHEREAL_HOST', 'smtp.ethereal.email'),
    port: Number(optional('ETHEREAL_PORT', '587')),
    secure: optional('ETHEREAL_SECURE', 'false') === 'true',
    user: process.env.ETHEREAL_USER ?? '',
    password: process.env.ETHEREAL_PASSWORD ?? '',
  };
}
