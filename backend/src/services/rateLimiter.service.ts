import type { Redis } from 'ioredis';
import { createRedisConnection } from '../config/redis.js';
import { logger } from '../utils/logger.js';

/**
 * Distributed send throttle.
 *
 * ## Why Redis
 *
 * An in-memory counter is wrong the moment a second worker or a second backend
 * instance exists, and it resets on restart. Every piece of throttle state
 * therefore lives in Redis, and every decision is a single atomic Lua script —
 * so "check the limit, then reserve a slot" cannot interleave between workers.
 *
 * ## Keys
 *
 *   email_rate:{senderId}:{hourWindow}   counter, one per sender per hour
 *   email_pace:{senderId}                epoch ms at which the next send may go
 *
 * `hourWindow` is `floor(epochMs / 3_600_000)`: a fixed, globally agreed
 * bucket, so two machines with correct clocks always resolve the same window
 * without coordinating. The counter is given a TTL slightly beyond the end of
 * its window, so buckets expire themselves and nothing needs cleaning up —
 * no sweeper, no cron.
 *
 * ## The algorithm
 *
 * Before each send a worker calls `acquireSendSlot`, which atomically:
 *
 *   1. Reads the sender's counter for the current hour window. If it has
 *      reached the limit, refuse and report the milliseconds remaining until
 *      the window rolls over.
 *   2. Reads the sender's pace marker. If the previous send was too recent,
 *      refuse and report the milliseconds until the next send is due.
 *   3. Otherwise reserve: INCR the counter, refresh its TTL, and push the pace
 *      marker to `now + minDelayMs`.
 *
 * Because all three steps run inside one script, N workers racing for the last
 * slot produce exactly one winner.
 *
 * A refusal is never a failure. The worker reschedules the job as a BullMQ
 * delayed job for the reported time, so the send is deferred, never dropped
 * and never counted as a retry attempt.
 */

const HOUR_MS = 3_600_000;

export interface SlotDecision {
  allowed: boolean;
  /** How long to wait before trying again. Zero when allowed. */
  retryAfterMs: number;
  reason: 'ok' | 'hour_limit' | 'min_delay';
  /** Sends already reserved in the current window. */
  used: number;
  limit: number;
}

export function currentWindow(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / HOUR_MS);
}

export function windowEndsAt(nowMs: number = Date.now()): number {
  return (currentWindow(nowMs) + 1) * HOUR_MS;
}

export function rateKey(senderId: string, window: number): string {
  return `email_rate:${senderId}:${window}`;
}

export function paceKey(senderId: string): string {
  return `email_pace:${senderId}`;
}

/**
 * KEYS[1] rate counter, KEYS[2] pace marker
 * ARGV[1] limit, ARGV[2] minDelayMs, ARGV[3] nowMs, ARGV[4] counter TTL ms
 * → { allowed, retryAfterMs, reason, used }
 */
const ACQUIRE_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
local minDelay = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

-- 1. Hour window exhausted: defer to the next window.
if used >= limit then
  return { 0, ttl, 'hour_limit', used }
end

-- 2. Too soon after the previous send from this sender.
local nextAllowed = tonumber(redis.call('GET', KEYS[2]) or '0')
if nextAllowed > now then
  return { 0, nextAllowed - now, 'min_delay', used }
end

-- 3. Reserve the slot and advance the pace marker.
used = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ttl)
redis.call('SET', KEYS[2], now + minDelay, 'PX', minDelay + 1000)
return { 1, 0, 'ok', used }
`;

/**
 * Returns a slot to the pool when a send did not actually happen, so a retry
 * is not charged twice. Guarded against going negative.
 */
const RELEASE_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used > 0 then
  return redis.call('DECR', KEYS[1])
end
return 0
`;

interface ThrottleCommands extends Redis {
  acquireSendSlot(
    rateKey: string,
    paceKey: string,
    limit: string,
    minDelayMs: string,
    nowMs: string,
    ttlMs: string,
  ): Promise<[number, number, string, number]>;
  releaseSendSlot(rateKey: string): Promise<number>;
}

let client: ThrottleCommands | null = null;

function getClient(): ThrottleCommands {
  if (client) return client;

  const connection = createRedisConnection('rate-limiter') as ThrottleCommands;
  connection.defineCommand('acquireSendSlot', { numberOfKeys: 2, lua: ACQUIRE_SCRIPT });
  connection.defineCommand('releaseSendSlot', { numberOfKeys: 1, lua: RELEASE_SCRIPT });
  client = connection;
  return client;
}

export interface AcquireOptions {
  senderId: string;
  /** Effective ceiling — the smaller of the campaign limit and the global one. */
  limit: number;
  minDelayMs: number;
  now?: number;
}

export async function acquireSendSlot(options: AcquireOptions): Promise<SlotDecision> {
  const now = options.now ?? Date.now();
  const window = currentWindow(now);
  // Outlive the window by a minute so a clock skew cannot expire it early.
  const ttlMs = windowEndsAt(now) - now + 60_000;

  const [allowed, retryAfterMs, reason, used] = await getClient().acquireSendSlot(
    rateKey(options.senderId, window),
    paceKey(options.senderId),
    String(options.limit),
    String(options.minDelayMs),
    String(now),
    String(ttlMs),
  );

  return {
    allowed: allowed === 1,
    // Never report zero on a refusal, or the job would requeue in a tight loop.
    retryAfterMs: allowed === 1 ? 0 : Math.max(retryAfterMs, 100),
    reason: reason as SlotDecision['reason'],
    used,
    limit: options.limit,
  };
}

export async function releaseSendSlot(senderId: string, now: number = Date.now()): Promise<void> {
  try {
    await getClient().releaseSendSlot(rateKey(senderId, currentWindow(now)));
  } catch (error) {
    // A leaked slot only makes the throttle briefly stricter — never a reason
    // to fail the send that is already being handled.
    logger.warn('Could not release rate-limit slot', { senderId, error });
  }
}

/**
 * Claims the right to announce "limit reached" for this sender and window.
 *
 * A full window defers every remaining email, so without this the worker would
 * fire one Slack message per deferred recipient. SET NX means exactly one
 * caller wins per sender per hour, however many workers are running.
 */
export async function claimLimitNotification(
  senderId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const window = currentWindow(now);
  const ttlMs = windowEndsAt(now) - now + 60_000;
  const result = await getClient().set(
    `slack_notified:${senderId}:${window}`,
    '1',
    'PX',
    ttlMs,
    'NX',
  );
  return result === 'OK';
}

/** Current usage, for diagnostics and the dashboard. */
export async function getUsage(senderId: string, now: number = Date.now()) {
  const window = currentWindow(now);
  const used = Number((await getClient().get(rateKey(senderId, window))) ?? 0);
  return { window, used, windowEndsAt: windowEndsAt(now) };
}
