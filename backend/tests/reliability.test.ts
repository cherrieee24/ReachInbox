import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { prisma, disconnectDatabase } from '../src/config/prisma.js';
import { closeRedisConnections } from '../src/config/redis.js';
import {
  closeEmailQueue,
  enqueueSends,
  getEmailQueue,
  type PendingSend,
} from '../src/queues/email.queue.js';
import {
  claimRecipientForSend,
  clearLease,
  leaseMs,
  releaseClaim,
} from '../src/services/delivery.service.js';
import { buildIdempotencyKey, scheduleEmails } from '../src/services/email.service.js';
import { recoverPendingSends } from '../src/services/recovery.service.js';
import { setupContext } from './helpers.js';

/**
 * Reliability suite. These are integration tests on purpose: the properties
 * under test — atomicity, uniqueness, lease expiry, queue persistence — are
 * enforced by PostgreSQL and Redis, so mocking them would test nothing.
 *
 * Requires the docker-compose stack to be running.
 */

const TAG_PREFIX = 'reltest-';
const TAG = `${TAG_PREFIX}${Date.now()}`;
let userId = '';
let senderId = '';

function futureIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/**
 * Removes both halves of the state a test creates. Deleting only the database
 * rows would leave their queue jobs behind to fire later and find nothing —
 * harmless, but it accumulates across runs.
 */
async function cleanup(): Promise<void> {
  const rows = await prisma.emailRecipient.findMany({
    where: { emailJob: { subject: { startsWith: TAG_PREFIX } } },
    select: { idempotencyKey: true },
  });

  const queue = getEmailQueue();
  for (const row of rows) {
    const job = await queue.getJob(row.idempotencyKey);
    await job?.remove().catch(() => undefined);
  }

  await prisma.emailJob.deleteMany({ where: { subject: { startsWith: TAG_PREFIX } } });
}

before(async () => {
  // Shares setupContext with the other suites so a clean database (CI, or a
  // fresh clone) provisions its own fixtures instead of demanding a manual
  // Google sign-in first.
  const context = await setupContext();
  userId = context.userId;
  senderId = context.senderId;

  await cleanup();
});

after(async () => {
  await cleanup();
  await closeEmailQueue();
  await closeRedisConnections();
  await disconnectDatabase();
});

/**
 * Job ids for one campaign, across the states a pending job can occupy.
 *
 * Queue-wide counters (`getJobCounts`) cannot express "this campaign gained no
 * duplicates": the suite files run as parallel processes against one Redis, so
 * another suite enqueueing or promoting a job between two reads moves the
 * total for reasons that have nothing to do with the assertion.
 */
async function queuedIdsFor(emailJobId: string): Promise<string[]> {
  const queue = getEmailQueue();
  const jobs = [...(await queue.getDelayed()), ...(await queue.getWaiting())];
  return jobs
    .filter((job) => job.data.emailJobId === emailJobId)
    .map((job) => String(job.id))
    .sort();
}

describe('Scenario 1 — restart recovery', () => {
  it('keeps every future email scheduled across a queue restart', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} scenario-1`,
      body: 'body',
      recipients: Array.from({ length: 10 }, (_, i) => `s1-${i}@reltest.io`),
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });

    const before = await prisma.emailRecipient.count({
      where: { emailJobId: job.id, status: 'SCHEDULED' },
    });
    assert.equal(before, 10, 'all ten rows should be scheduled');

    // Simulate the process going away and coming back.
    await closeEmailQueue();
    const queue = getEmailQueue();

    const delayed = await queue.getDelayed();
    const mine = delayed.filter((d) => d.data.emailJobId === job.id);
    assert.equal(mine.length, 10, 'delayed jobs survive in Redis');

    // Boot-time reconciliation must not duplicate anything.
    const idsBefore = await queuedIdsFor(job.id);
    await recoverPendingSends();
    const idsAfter = await queuedIdsFor(job.id);
    assert.deepEqual(idsAfter, idsBefore, 'recovery is idempotent — no duplicate jobs');

    const after = await prisma.emailRecipient.count({
      where: { emailJobId: job.id, status: 'SCHEDULED' },
    });
    assert.equal(after, 10, 'database state is unchanged by a restart');
  });

  it('rebuilds queue state from PostgreSQL when Redis has lost it', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} scenario-1b`,
      body: 'body',
      recipients: ['s1b-a@reltest.io', 's1b-b@reltest.io'],
      startTime: new Date(futureIso(45)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });

    const queue = getEmailQueue();
    const rows = await prisma.emailRecipient.findMany({
      where: { emailJobId: job.id },
      select: { idempotencyKey: true },
    });

    // Drop this campaign's jobs, as a Redis flush would.
    for (const row of rows) {
      const existing = await queue.getJob(row.idempotencyKey);
      await existing?.remove();
    }
    for (const row of rows) {
      assert.equal(await queue.getJob(row.idempotencyKey), undefined);
    }

    await recoverPendingSends();

    for (const row of rows) {
      assert.ok(
        await queue.getJob(row.idempotencyKey),
        'recovery re-enqueues work the database still considers pending',
      );
    }
  });
});

describe('Scenario 2 — worker crashes mid-send', () => {
  it('lets another worker reclaim the row once the lease expires', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} scenario-2`,
      body: 'body',
      recipients: ['s2@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });
    const row = await prisma.emailRecipient.findFirstOrThrow({
      where: { emailJobId: job.id },
    });

    const first = await claimRecipientForSend(row.id, 'worker-that-dies');
    assert.equal(first.claimed, true);

    // While the lease is live, nobody else may take it.
    const tooSoon = await claimRecipientForSend(row.id, 'worker-b');
    assert.equal(tooSoon.claimed, false);
    assert.equal(tooSoon.claimed === false && tooSoon.reason, 'held_by_other');

    // The worker died: age its lease past the expiry window.
    await prisma.emailRecipient.update({
      where: { id: row.id },
      data: { lockedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const reclaimed = await claimRecipientForSend(row.id, 'worker-b');
    assert.equal(reclaimed.claimed, true, 'an abandoned lease becomes claimable');

    const after = await prisma.emailRecipient.findFirstOrThrow({ where: { id: row.id } });
    assert.equal(after.lockedBy, 'worker-b', 'ownership transferred');
    assert.equal(after.status, 'PROCESSING');
  });

  it('returns a row to a claimable state when a send is released', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} scenario-2b`,
      body: 'body',
      recipients: ['s2b@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });
    const row = await prisma.emailRecipient.findFirstOrThrow({
      where: { emailJobId: job.id },
    });

    await claimRecipientForSend(row.id, 'worker-a');
    await releaseClaim(row.id, 'SCHEDULED', 'worker-a');

    const released = await prisma.emailRecipient.findFirstOrThrow({ where: { id: row.id } });
    assert.equal(released.status, 'SCHEDULED');
    assert.equal(released.lockedBy, null);

    const next = await claimRecipientForSend(row.id, 'worker-b');
    assert.equal(next.claimed, true, 'a released row is immediately claimable');
  });

  it('refunds the attempt only for the worker that holds the lease', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} scenario-2f`,
      body: 'body',
      recipients: ['s2f@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });
    const row = await prisma.emailRecipient.findFirstOrThrow({
      where: { emailJobId: job.id },
    });

    await claimRecipientForSend(row.id, 'worker-a');
    const claimed = await prisma.emailRecipient.findFirstOrThrow({ where: { id: row.id } });
    assert.equal(claimed.attempts, 1);

    // A straggler must not be able to decrement someone else's counter.
    const stolen = await releaseClaim(row.id, 'SCHEDULED', 'worker-stale', true);
    assert.equal(stolen, false);
    const untouched = await prisma.emailRecipient.findFirstOrThrow({ where: { id: row.id } });
    assert.equal(untouched.attempts, 1, 'attempts unchanged by a non-holder');

    // The real holder refunds it, because the send never happened.
    const released = await releaseClaim(row.id, 'SCHEDULED', 'worker-a', true);
    assert.equal(released, true);
    const refunded = await prisma.emailRecipient.findFirstOrThrow({ where: { id: row.id } });
    assert.equal(refunded.attempts, 0, 'a throttled deferral does not consume a retry');
  });

  it('refuses a release from a worker that no longer holds the lease', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} scenario-2c`,
      body: 'body',
      recipients: ['s2c@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });
    const row = await prisma.emailRecipient.findFirstOrThrow({
      where: { emailJobId: job.id },
    });

    await claimRecipientForSend(row.id, 'worker-a');
    // A straggler tries to release a lease it does not own.
    await releaseClaim(row.id, 'SCHEDULED', 'worker-stale');

    const still = await prisma.emailRecipient.findFirstOrThrow({ where: { id: row.id } });
    assert.equal(still.status, 'PROCESSING', 'the real holder keeps the lease');
    assert.equal(still.lockedBy, 'worker-a');
  });
});

describe('Scenario 2 — abandoned rows are recovered, not orphaned', () => {
  it('re-enqueues a PROCESSING row whose worker died and whose job Redis lost', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} scenario-2d`,
      body: 'body',
      recipients: ['s2d@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });
    const row = await prisma.emailRecipient.findFirstOrThrow({
      where: { emailJobId: job.id },
    });
    const queue = getEmailQueue();

    // A worker claimed the row and then died...
    await prisma.emailRecipient.update({
      where: { id: row.id },
      data: {
        status: 'PROCESSING',
        lockedBy: 'dead-worker',
        lockedAt: new Date(Date.now() - leaseMs() - 60_000),
      },
    });
    // ...and Redis then lost the job, so nothing would redeliver it.
    await (await queue.getJob(row.idempotencyKey))?.remove();
    assert.equal(await queue.getJob(row.idempotencyKey), undefined);

    const result = await recoverPendingSends();

    assert.ok(
      await queue.getJob(row.idempotencyKey),
      'an abandoned row must be re-enqueued, not left to hang forever',
    );
    assert.ok(result.reclaimed >= 1, 'recovery reports how many rows it rescued');
  });

  it('leaves a live lease alone during recovery', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} scenario-2e`,
      body: 'body',
      recipients: ['s2e@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });
    const row = await prisma.emailRecipient.findFirstOrThrow({
      where: { emailJobId: job.id },
    });

    // Claimed just now — a send may be in flight.
    await claimRecipientForSend(row.id, 'worker-live');
    const queue = getEmailQueue();
    await (await queue.getJob(row.idempotencyKey))?.remove();

    await recoverPendingSends();

    assert.equal(
      await queue.getJob(row.idempotencyKey),
      undefined,
      'a fresh lease must not be re-enqueued underneath a working sender',
    );
    const still = await prisma.emailRecipient.findFirstOrThrow({ where: { id: row.id } });
    assert.equal(still.lockedBy, 'worker-live', 'ownership is untouched');
  });
});

describe('Scenario 3 — job retried after a successful send', () => {
  it('never claims a row that has already been sent', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} scenario-3`,
      body: 'body',
      recipients: ['s3@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });
    const row = await prisma.emailRecipient.findFirstOrThrow({
      where: { emailJobId: job.id },
    });

    // Deliver it.
    await claimRecipientForSend(row.id, 'worker-a');
    await prisma.emailRecipient.update({
      where: { id: row.id },
      data: { status: 'SENT', sentAt: new Date(), providerMessageId: '<first@send>' },
    });
    await clearLease(row.id);

    // Redelivery of the same job, from any worker.
    for (const worker of ['worker-a', 'worker-b', 'worker-c']) {
      const retry = await claimRecipientForSend(row.id, worker);
      assert.equal(retry.claimed, false);
      assert.equal(retry.claimed === false && retry.reason, 'already_sent');
    }

    const after = await prisma.emailRecipient.findFirstOrThrow({ where: { id: row.id } });
    assert.equal(after.status, 'SENT');
    assert.equal(after.providerMessageId, '<first@send>', 'the original send is untouched');
  });

  it('never claims a cancelled row', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} scenario-3b`,
      body: 'body',
      recipients: ['s3b@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });
    const row = await prisma.emailRecipient.findFirstOrThrow({
      where: { emailJobId: job.id },
    });

    await prisma.emailRecipient.update({
      where: { id: row.id },
      data: { status: 'CANCELLED' },
    });

    const attempt = await claimRecipientForSend(row.id, 'worker-a');
    assert.equal(attempt.claimed, false);
    assert.equal(attempt.claimed === false && attempt.reason, 'cancelled');
  });
});

describe('Scenario 4 — two workers, one logical job', () => {
  it('grants the row to exactly one of many concurrent workers', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} scenario-4`,
      body: 'body',
      recipients: ['s4@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });
    const row = await prisma.emailRecipient.findFirstOrThrow({
      where: { emailJobId: job.id },
    });

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => claimRecipientForSend(row.id, `worker-${i}`)),
    );

    const winners = results.filter((r) => r.claimed);
    assert.equal(winners.length, 1, 'exactly one worker may send');

    const after = await prisma.emailRecipient.findFirstOrThrow({ where: { id: row.id } });
    assert.equal(after.attempts, 1, 'the attempt counter records a single claim');
  });

  it('holds under repeated concurrent bursts across many rows', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} scenario-4b`,
      body: 'body',
      recipients: Array.from({ length: 12 }, (_, i) => `s4b-${i}@reltest.io`),
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });
    const rows = await prisma.emailRecipient.findMany({ where: { emailJobId: job.id } });

    for (const row of rows) {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => claimRecipientForSend(row.id, `burst-${i}`)),
      );
      assert.equal(results.filter((r) => r.claimed).length, 1, `row ${row.email} double-claimed`);
    }
  });
});

describe('Scenario 5 — duplicate scheduling request', () => {
  it('returns the same campaign for a repeated idempotency key', async () => {
    const key = `test-${TAG}-a`;
    const payload = {
      subject: `${TAG} scenario-5`,
      body: 'body',
      recipients: ['s5-a@reltest.io', 's5-b@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    };

    const first = await scheduleEmails(userId, payload, key);
    const second = await scheduleEmails(userId, payload, key);

    assert.equal(second.id, first.id, 'the second request replays the first campaign');
    assert.equal(second.deduplicated, true);
    assert.equal(first.deduplicated, false);

    const jobs = await prisma.emailJob.count({
      where: { userId, subject: `${TAG} scenario-5` },
    });
    assert.equal(jobs, 1, 'only one campaign exists');

    const recipients = await prisma.emailRecipient.count({ where: { emailJobId: first.id } });
    assert.equal(recipients, 2, 'recipients were not duplicated');
  });

  it('survives two identical requests racing concurrently', async () => {
    const key = `test-${TAG}-race`;
    const payload = {
      subject: `${TAG} scenario-5b`,
      body: 'body',
      recipients: ['s5race@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    };

    // No fast-path read can help here — the unique index has to arbitrate.
    const [a, b, c] = await Promise.all([
      scheduleEmails(userId, payload, key),
      scheduleEmails(userId, payload, key),
      scheduleEmails(userId, payload, key),
    ]);

    assert.equal(a.id, b.id);
    assert.equal(b.id, c.id);

    const jobs = await prisma.emailJob.count({
      where: { userId, subject: `${TAG} scenario-5b` },
    });
    assert.equal(jobs, 1, 'concurrent duplicates collapse to one campaign');
  });

  it('still allows a deliberate resend under a different key', async () => {
    const payload = {
      subject: `${TAG} scenario-5c`,
      body: 'body',
      recipients: ['s5c@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    };

    const first = await scheduleEmails(userId, payload, `${TAG}-k1`);
    const second = await scheduleEmails(userId, payload, `${TAG}-k2`);

    assert.notEqual(first.id, second.id, 'a new key means a new campaign');
  });
});

describe('Database consistency invariants', () => {
  it('rejects a duplicate recipient idempotency key at the database level', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} invariants`,
      body: 'body',
      recipients: ['inv-a@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });
    const row = await prisma.emailRecipient.findFirstOrThrow({
      where: { emailJobId: job.id },
    });

    await assert.rejects(
      prisma.emailRecipient.create({
        data: {
          emailJobId: job.id,
          userId,
          email: 'someone-else@reltest.io',
          scheduledAt: new Date(),
          idempotencyKey: row.idempotencyKey,
        },
      }),
      'the unique index must refuse a reused key',
    );
  });

  it('derives recipient keys deterministically', () => {
    const a = buildIdempotencyKey('job-1', 'Person@Example.com');
    const b = buildIdempotencyKey('job-1', 'person@example.com');
    const c = buildIdempotencyKey('job-2', 'person@example.com');

    assert.equal(a, b, 'address casing must not change the key');
    assert.notEqual(a, c, 'a different campaign must produce a different key');
  });

  it('cascades recipient rows when a campaign is deleted', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} cascade`,
      body: 'body',
      recipients: ['cascade-a@reltest.io', 'cascade-b@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });

    // Capture the queue ids first: once the rows cascade away, nothing can
    // tell us which jobs belonged to them.
    const rows = await prisma.emailRecipient.findMany({
      where: { emailJobId: job.id },
      select: { idempotencyKey: true },
    });

    await prisma.emailJob.delete({ where: { id: job.id } });
    const orphans = await prisma.emailRecipient.count({ where: { emailJobId: job.id } });
    assert.equal(orphans, 0, 'no orphaned recipients');

    const queue = getEmailQueue();
    for (const row of rows) {
      await (await queue.getJob(row.idempotencyKey))?.remove().catch(() => undefined);
    }
  });
});

describe('Queue persistence', () => {
  it('enqueues each recipient exactly once, however many times it is asked', async () => {
    const job = await scheduleEmails(userId, {
      subject: `${TAG} queue-dedup`,
      body: 'body',
      recipients: ['qd@reltest.io'],
      startTime: new Date(futureIso(30)),
      delayBetweenEmails: 30,
      hourlyLimit: 100,
      senderId,
    });
    const row = await prisma.emailRecipient.findFirstOrThrow({
      where: { emailJobId: job.id },
    });

    const send: PendingSend = {
      emailRecipientId: row.id,
      emailJobId: job.id,
      userId,
      senderId,
      scheduledAt: row.scheduledAt,
      idempotencyKey: row.idempotencyKey,
    };

    const before = await queuedIdsFor(job.id);
    for (let i = 0; i < 5; i += 1) await enqueueSends([send]);
    const after = await queuedIdsFor(job.id);

    assert.deepEqual(
      after,
      before,
      'the job id is the idempotency key, so duplicates are rejected by Redis',
    );
  });
});
