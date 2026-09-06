import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

import { disconnectDatabase, prisma } from '../src/config/prisma.js';
import { closeRedisConnections, createRedisConnection } from '../src/config/redis.js';
import { closeEmailQueue } from '../src/queues/email.queue.js';
import { scheduleEmails } from '../src/services/email.service.js';
import { currentWindow, paceKey, rateKey } from '../src/services/rateLimiter.service.js';
import { cleanupBySubject, fakeJob, futureIso, setupContext, tag, tagPrefix, type TestContext } from './helpers.js';

/**
 * Worker behaviour, driven through the real processor.
 *
 * The SMTP boundary is the one thing stubbed: sending over the network would
 * make these tests slow and flaky, and the transport itself is not what is
 * under test. Everything else — claim, throttle, status transitions, retry
 * accounting, counters — runs for real against PostgreSQL and Redis.
 */

const SUBJECT = tag('worker');
let ctx: TestContext;
let redis: ReturnType<typeof createRedisConnection>;

/** Controls what the stubbed transport does for the next send. */
const transport: { fail: Error | null; calls: { to: string; subject: string }[] } = {
  fail: null,
  calls: [],
};

mock.module('../src/services/mailer.service.js', {
  namedExports: {
    sendEmail: async (message: { to: string; subject: string }) => {
      transport.calls.push({ to: message.to, subject: message.subject });
      if (transport.fail) throw transport.fail;
      return {
        messageId: `<stub-${transport.calls.length}@test>`,
        previewUrl: 'https://ethereal.email/message/stub',
        accepted: [message.to],
        rejected: [],
      };
    },
    describeTransport: () => 'stub',
    closeMailer: () => undefined,
    verifyTransport: async () => true,
  },
});

/**
 * Loaded in `before()` rather than at module scope: the file compiles to CJS,
 * where top-level await is unavailable, and the import has to happen after
 * `mock.module` so the worker binds to the stub.
 */
let processSendJob: typeof import('../src/workers/email.worker.js').processSendJob;

async function makeCampaign(name: string, recipients: string[], hourlyLimit = 1000) {
  const job = await scheduleEmails(ctx.userId, {
    subject: `${SUBJECT} ${name}`,
    body: 'body',
    recipients,
    startTime: new Date(futureIso(1)),
    delayBetweenEmails: 1,
    hourlyLimit,
    senderId: ctx.senderId,
  });
  const rows = await prisma.emailRecipient.findMany({
    where: { emailJobId: job.id },
    orderBy: { scheduledAt: 'asc' },
  });
  return { job, rows };
}

/** Clears the sender's throttle state so each test starts with a full budget. */
async function resetThrottle(): Promise<void> {
  await redis.del(rateKey(ctx.senderId, currentWindow()), paceKey(ctx.senderId));
}

before(async () => {
  ({ processSendJob } = await import('../src/workers/email.worker.js'));
  ctx = await setupContext();
  redis = createRedisConnection('worker-test');
  await cleanupBySubject(tagPrefix('worker'));
});

beforeEach(async () => {
  transport.fail = null;
  transport.calls = [];
  await resetThrottle();
});

after(async () => {
  await cleanupBySubject(tagPrefix('worker'));
  redis.disconnect();
  await closeEmailQueue();
  await closeRedisConnections();
  await disconnectDatabase();
});

describe('Worker execution', () => {
  it('sends, then records delivery metadata on the row', async () => {
    const { job, rows } = await makeCampaign('send', ['send@worker.test']);
    const row = rows[0]!;

    const outcome = await processSendJob(
      fakeJob({ id: 'j1', recipientId: row.id, emailJobId: job.id, userId: ctx.userId, senderId: ctx.senderId }) as never,
    );

    assert.equal(outcome.result, 'sent');
    assert.equal(transport.calls.length, 1);
    assert.equal(transport.calls[0]!.to, 'send@worker.test');

    const after = await prisma.emailRecipient.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.status, 'SENT');
    assert.ok(after.sentAt);
    assert.equal(after.providerMessageId, '<stub-1@test>');
    assert.equal(after.previewUrl, 'https://ethereal.email/message/stub');
    assert.equal(after.lockedBy, null, 'the lease is released');
    assert.ok(after.lockedAt, 'the dispatch time is kept');
  });

  it('advances the campaign to PROCESSING, then COMPLETED', async () => {
    const { job, rows } = await makeCampaign('lifecycle', ['a@worker.test', 'b@worker.test']);

    await processSendJob(
      fakeJob({ id: 'j2a', recipientId: rows[0]!.id, emailJobId: job.id, userId: ctx.userId, senderId: ctx.senderId }) as never,
    );
    const mid = await prisma.emailJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(mid.status, 'PROCESSING');
    assert.equal(mid.sentCount, 1);
    assert.ok(mid.startedAt);

    await resetThrottle();
    await processSendJob(
      fakeJob({ id: 'j2b', recipientId: rows[1]!.id, emailJobId: job.id, userId: ctx.userId, senderId: ctx.senderId }) as never,
    );
    const done = await prisma.emailJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(done.status, 'COMPLETED');
    assert.equal(done.sentCount, 2);
    assert.ok(done.completedAt);
  });

  it('does not send again when the job is redelivered after success', async () => {
    const { job, rows } = await makeCampaign('replay', ['replay@worker.test']);
    const row = rows[0]!;
    const makeJob = (id: string) =>
      fakeJob({ id, recipientId: row.id, emailJobId: job.id, userId: ctx.userId, senderId: ctx.senderId }) as never;

    await processSendJob(makeJob('j3a'));
    assert.equal(transport.calls.length, 1);

    await resetThrottle();
    const second = await processSendJob(makeJob('j3b'));

    assert.equal(second.result, 'skipped');
    assert.equal(second.result === 'skipped' && second.reason, 'already_sent');
    assert.equal(transport.calls.length, 1, 'the transport must not be called twice');
  });

  it('skips a cancelled recipient', async () => {
    const { job, rows } = await makeCampaign('cancelled', ['cancel@worker.test']);
    await prisma.emailRecipient.update({ where: { id: rows[0]!.id }, data: { status: 'CANCELLED' } });

    const outcome = await processSendJob(
      fakeJob({ id: 'j4', recipientId: rows[0]!.id, emailJobId: job.id, userId: ctx.userId, senderId: ctx.senderId }) as never,
    );

    assert.equal(outcome.result, 'skipped');
    assert.equal(transport.calls.length, 0);
  });

  it('skips a recipient that has been deleted', async () => {
    const outcome = await processSendJob(
      fakeJob({
        id: 'j5',
        recipientId: 'cmzzzzzzzzzzzzzzzzzzzzzzzz',
        emailJobId: 'cmzzzzzzzzzzzzzzzzzzzzzzzy',
        userId: ctx.userId,
        senderId: ctx.senderId,
      }) as never,
    );
    assert.equal(outcome.result, 'skipped');
    assert.equal(outcome.result === 'skipped' && outcome.reason, 'recipient_deleted');
  });
});

describe('Worker retries', () => {
  it('returns the row to a claimable state and rethrows on a non-final attempt', async () => {
    const { job, rows } = await makeCampaign('retry', ['retry@worker.test']);
    const row = rows[0]!;
    transport.fail = new Error('connect ECONNREFUSED');

    await assert.rejects(
      processSendJob(
        fakeJob({
          id: 'j6', recipientId: row.id, emailJobId: job.id, userId: ctx.userId,
          senderId: ctx.senderId, attemptsMade: 0, attempts: 3,
        }) as never,
      ),
      /ECONNREFUSED/,
    );

    const after = await prisma.emailRecipient.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.status, 'SCHEDULED', 'a retryable failure must stay claimable');
    assert.match(String(after.errorMessage), /ECONNREFUSED/);
    assert.equal(after.lockedBy, null, 'the lease is released for the retry');
  });

  it('marks the row FAILED on the final attempt and counts it', async () => {
    const { job, rows } = await makeCampaign('final', ['final@worker.test']);
    const row = rows[0]!;
    transport.fail = new Error('550 mailbox unavailable');

    await assert.rejects(
      processSendJob(
        fakeJob({
          id: 'j7', recipientId: row.id, emailJobId: job.id, userId: ctx.userId,
          senderId: ctx.senderId, attemptsMade: 2, attempts: 3,
        }) as never,
      ),
    );

    const after = await prisma.emailRecipient.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.status, 'FAILED');
    assert.match(String(after.errorMessage), /550/);

    const parent = await prisma.emailJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(parent.failedCount, 1);
    assert.equal(parent.status, 'FAILED', 'every recipient failed, so the campaign did too');
  });

  it('refunds the hourly slot when a send fails, so a retry is not charged twice', async () => {
    const { job, rows } = await makeCampaign('refund', ['refund@worker.test']);
    transport.fail = new Error('temporary');

    await assert.rejects(
      processSendJob(
        fakeJob({ id: 'j8', recipientId: rows[0]!.id, emailJobId: job.id, userId: ctx.userId, senderId: ctx.senderId }) as never,
      ),
    );

    const used = Number((await redis.get(rateKey(ctx.senderId, currentWindow()))) ?? 0);
    assert.equal(used, 0, 'the reserved slot is returned when nothing was sent');
  });
});

describe('Worker throttling', () => {
  it('defers rather than fails once the hourly budget is spent', async () => {
    const { job, rows } = await makeCampaign('throttle', ['t1@worker.test', 't2@worker.test'], 1);
    let deferredTo = 0;

    // First send consumes the campaign's budget of one.
    await processSendJob(
      fakeJob({ id: 'j9a', recipientId: rows[0]!.id, emailJobId: job.id, userId: ctx.userId, senderId: ctx.senderId }) as never,
    );

    await assert.rejects(
      processSendJob(
        fakeJob({
          id: 'j9b', recipientId: rows[1]!.id, emailJobId: job.id, userId: ctx.userId,
          senderId: ctx.senderId, onMoveToDelayed: (runAt) => { deferredTo = runAt; },
        }) as never,
      ),
      (error: Error) => error.name === 'DelayedError',
      'a throttled job is rescheduled, not failed',
    );

    assert.ok(deferredTo > Date.now(), 'it is pushed into the future');
    assert.equal(transport.calls.length, 1, 'only the first send happened');

    const deferred = await prisma.emailRecipient.findUniqueOrThrow({ where: { id: rows[1]!.id } });
    assert.equal(deferred.status, 'SCHEDULED', 'still pending, not failed');
    assert.equal(deferred.attempts, 0, 'a deferral must not consume a retry');
    assert.ok(
      deferred.scheduledAt.getTime() >= Date.now(),
      'the new run time is written back to PostgreSQL',
    );
  });

  it('paces consecutive sends with the minimum delay', async () => {
    process.env.MIN_EMAIL_DELAY_MS = '5000';
    try {
      const { job, rows } = await makeCampaign('pace', ['p1@worker.test', 'p2@worker.test']);
      await processSendJob(
        fakeJob({ id: 'j10a', recipientId: rows[0]!.id, emailJobId: job.id, userId: ctx.userId, senderId: ctx.senderId }) as never,
      );

      await assert.rejects(
        processSendJob(
          fakeJob({ id: 'j10b', recipientId: rows[1]!.id, emailJobId: job.id, userId: ctx.userId, senderId: ctx.senderId }) as never,
        ),
        (error: Error) => error.name === 'DelayedError',
        'the second send is spaced out, not sent immediately',
      );
      assert.equal(transport.calls.length, 1);
    } finally {
      delete process.env.MIN_EMAIL_DELAY_MS;
    }
  });
});

describe('Worker concurrency', () => {
  it('sends once when many workers race for the same recipient', async () => {
    const { job, rows } = await makeCampaign('race', ['race@worker.test']);
    const row = rows[0]!;

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        processSendJob(
          fakeJob({ id: `j11-${i}`, recipientId: row.id, emailJobId: job.id, userId: ctx.userId, senderId: ctx.senderId }) as never,
        ),
      ),
    );

    const sent = results.filter(
      (r) => r.status === 'fulfilled' && r.value.result === 'sent',
    );
    assert.equal(sent.length, 1, 'exactly one worker may send');
    assert.equal(transport.calls.length, 1, 'the transport is called once');

    const after = await prisma.emailRecipient.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.status, 'SENT');
  });
});
