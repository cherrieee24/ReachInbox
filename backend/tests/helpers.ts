import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma.js';
import { getEmailQueue } from '../src/queues/email.queue.js';
import { signSessionToken } from '../src/utils/jwt.js';

/**
 * Shared fixtures for the integration suites.
 *
 * These tests run against the real PostgreSQL, Redis and Elasticsearch from
 * docker-compose. The behaviour under test — atomicity, uniqueness, index
 * consistency, queue persistence — lives in those services, so substituting
 * fakes would test the fakes.
 */

export interface TestContext {
  userId: string;
  userEmail: string;
  senderId: string;
  otherUserId: string;
  otherSenderId: string;
  cookie: string;
  otherCookie: string;
}

/**
 * Per-run namespace, so two suites never collide on a unique constraint.
 *
 * Cleanup uses `tagPrefix` rather than this value: a suite that was killed
 * mid-run leaves rows behind under a different pid, and those would otherwise
 * accumulate and skew later assertions about counts.
 */
export function tag(name: string): string {
  return `${tagPrefix(name)}${process.pid}`;
}

/** Matches every run of a suite, past and present. */
export function tagPrefix(name: string): string {
  return `test-${name}-`;
}

/**
 * Two users are needed: one to own data, one to prove it cannot reach it.
 *
 * Real Google sign-ins are reused when present, so a local run exercises the
 * same rows a developer sees in the UI. On a clean database — CI, or a fresh
 * clone — deterministic fixtures are created instead, because requiring a
 * manual OAuth round trip before the suite can run would make it unrunnable
 * anywhere but a workstation. Fixtures are keyed by googleId so repeat runs
 * reuse them rather than accumulating users.
 */
async function ensureUsers() {
  const existing = await prisma.user.findMany({ orderBy: { createdAt: 'asc' }, take: 2 });
  if (existing[0] && existing[1]) return existing;

  // Read-then-create rather than upsert: node:test runs the suite files as
  // parallel processes, and concurrent upserts of the same unique key take
  // conflicting row locks and stall. The happy path here takes no lock at
  // all, and the loser of a genuine race recovers by re-reading.
  const fixture = async (slug: string, name: string) => {
    const googleId = `test-fixture-${slug}`;
    const found = await prisma.user.findUnique({ where: { googleId } });
    if (found) return found;

    try {
      return await prisma.user.create({
        data: { googleId, email: `${slug}@fixture.test`, name },
      });
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'P2002') throw error;
      const raced = await prisma.user.findUnique({ where: { googleId } });
      assert.ok(raced, 'lost the fixture race but the winner is missing');
      return raced;
    }
  };

  const primary = existing[0] ?? (await fixture('primary', 'Fixture Primary'));
  const other =
    existing.find((user) => user.id !== primary.id) ?? (await fixture('secondary', 'Fixture Secondary'));

  return [primary, other];
}

/** Race-safe for the same reason the user fixtures are: suites run in parallel. */
async function ensureSender(userId: string, fromEmail: string, name: string) {
  const where = { userId_fromEmail: { userId, fromEmail } };
  const found = await prisma.sender.findUnique({ where });
  if (found) return found;

  try {
    return await prisma.sender.create({
      data: { userId, name, fromEmail, provider: 'ETHEREAL', isDefault: true },
    });
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'P2002') throw error;
    const raced = await prisma.sender.findUnique({ where });
    assert.ok(raced, 'lost the sender race but the winner is missing');
    return raced;
  }
}

export async function setupContext(): Promise<TestContext> {
  const users = await ensureUsers();
  assert.ok(users[0], 'a primary user is required');
  assert.ok(users[1], 'a second user is required for the isolation tests');

  const [primary, other] = users;

  const sender = (await prisma.sender.findFirst({ where: { userId: primary.id } }))
    ?? (await ensureSender(primary.id, 'tests@reachinbox.local', 'Test Sender'));

  const otherSender = await ensureSender(
    other.id,
    'other-tests@reachinbox.local',
    'Other Sender',
  );

  return {
    userId: primary.id,
    userEmail: primary.email,
    senderId: sender.id,
    otherUserId: other.id,
    otherSenderId: otherSender.id,
    cookie: sessionCookie(primary.id, primary.email),
    otherCookie: sessionCookie(other.id, other.email),
  };
}

export function sessionCookie(userId: string, email: string): string {
  return `reachinbox_session=${signSessionToken({ sub: userId, email })}`;
}

export function futureIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/**
 * Removes campaigns and the queue jobs they created. Deleting only the rows
 * would leave orphan jobs to fire later and accumulate across runs.
 */
export async function cleanupBySubject(prefix: string): Promise<void> {
  const rows = await prisma.emailRecipient.findMany({
    where: { emailJob: { subject: { startsWith: prefix } } },
    select: { idempotencyKey: true },
  });

  const queue = getEmailQueue();
  for (const row of rows) {
    await (await queue.getJob(row.idempotencyKey))?.remove().catch(() => undefined);
  }

  await prisma.emailJob.deleteMany({ where: { subject: { startsWith: prefix } } });
}

/** Minimal stand-in for a BullMQ job, for driving the processor directly. */
export function fakeJob(options: {
  id: string;
  recipientId: string;
  emailJobId: string;
  userId: string;
  senderId: string;
  attemptsMade?: number;
  attempts?: number;
  onMoveToDelayed?: (runAt: number) => void;
}) {
  return {
    id: options.id,
    name: 'send-email',
    attemptsMade: options.attemptsMade ?? 0,
    opts: { attempts: options.attempts ?? 3 },
    data: {
      emailRecipientId: options.recipientId,
      emailJobId: options.emailJobId,
      userId: options.userId,
      senderId: options.senderId,
    },
    moveToDelayed: async (runAt: number) => {
      options.onMoveToDelayed?.(runAt);
      await Promise.resolve();
    },
  };
}
