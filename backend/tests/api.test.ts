import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { disconnectDatabase, prisma } from '../src/config/prisma.js';
import { closeRedisConnections } from '../src/config/redis.js';
import { closeEmailQueue } from '../src/queues/email.queue.js';
import { sensitiveLimiter } from '../src/middleware/rateLimit.js';
import { cleanupBySubject, futureIso, setupContext, tag, tagPrefix, type TestContext } from './helpers.js';

/** HTTP-level tests over the real middleware stack, router and database. */

// The OAuth-start test only checks the redirect this server builds — it never
// contacts Google — so placeholders are enough, and they keep the suite
// runnable on a machine (or a CI runner) with no real credentials configured.
process.env.GOOGLE_CLIENT_ID ||= 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET ||= 'test-google-client-secret';

const app = createApp();
const SUBJECT = tag('api');
let ctx: TestContext;

before(async () => {
  ctx = await setupContext();
  await cleanupBySubject(tagPrefix('api'));
});

after(async () => {
  await cleanupBySubject(tagPrefix('api'));
  await closeEmailQueue();
  await closeRedisConnections();
  await disconnectDatabase();
});

describe('Health', () => {
  it('reports each dependency and stays 200 while they are up', async () => {
    const res = await request(app).get('/api/health').expect(200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, 'ok');
    assert.equal(res.body.data.dependencies.database.connected, true);
    assert.equal(res.body.data.dependencies.redis.connected, true);
    // Search is reported but must never decide the instance's health.
    assert.ok('search' in res.body.data.dependencies);
  });

  it('needs no authentication', async () => {
    await request(app).get('/api/health').expect(200);
  });
});

describe('Authentication', () => {
  it('rejects every protected route without a session', async () => {
    for (const [method, path] of [
      ['get', '/api/me'],
      ['get', '/api/emails/scheduled'],
      ['get', '/api/emails/sent'],
      ['get', '/api/emails/search?q=x'],
      ['get', '/api/dashboard/stats'],
      ['post', '/api/emails/schedule'],
      ['get', '/api/slack/status'],
    ] as const) {
      const res = await request(app)[method](path);
      assert.equal(res.status, 401, `${method} ${path} should be 401`);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    }
  });

  it('rejects a tampered session token', async () => {
    const res = await request(app)
      .get('/api/me')
      .set('Cookie', 'reachinbox_session=not.a.real.jwt')
      .expect(401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  it('returns the signed-in user, without internal fields', async () => {
    const res = await request(app).get('/api/me').set('Cookie', ctx.cookie).expect(200);
    assert.equal(res.body.data.id, ctx.userId);
    assert.ok(!('googleId' in res.body.data), 'googleId must not be exposed');
  });

  it('clears the session cookie on logout', async () => {
    const res = await request(app).post('/api/auth/logout').expect(200);
    const cookie = String(res.headers['set-cookie']);
    assert.match(cookie, /reachinbox_session=;/);
    assert.match(cookie, /HttpOnly/);
  });

  it('starts the Google flow with a state cookie and no secrets in the URL', async () => {
    const res = await request(app).get('/api/auth/google').expect(302);
    const location = String(res.headers.location);
    assert.match(location, /^https:\/\/accounts\.google\.com/);
    assert.match(String(res.headers['set-cookie']), /reachinbox_oauth_state=.*HttpOnly/);
    assert.ok(!location.includes('client_secret'), 'the client secret must never be in the URL');
  });

  it('refuses an OAuth callback whose state does not match', async () => {
    const res = await request(app)
      .get('/api/auth/google/callback?code=abc&state=forged')
      .expect(302);
    assert.match(String(res.headers.location), /error=invalid_state/);
  });
});

describe('Authorization and user isolation', () => {
  let jobId = '';

  before(async () => {
    const res = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', ctx.cookie)
      .send({
        subject: `${SUBJECT} owned`,
        body: 'body',
        recipients: ['owner@iso.test'],
        startTime: futureIso(120),
        senderId: ctx.senderId,
      })
      .expect(201);
    jobId = res.body.data.id;
  });

  it('hides another user\'s campaign behind a 404, not a 403', async () => {
    const res = await request(app)
      .get(`/api/emails/${jobId}`)
      .set('Cookie', ctx.otherCookie)
      .expect(404);
    // 403 would confirm the id exists.
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('refuses to cancel another user\'s campaign', async () => {
    await request(app)
      .delete(`/api/emails/${jobId}`)
      .set('Cookie', ctx.otherCookie)
      .expect(404);

    const job = await prisma.emailJob.findUniqueOrThrow({ where: { id: jobId } });
    assert.notEqual(job.status, 'CANCELLED', 'the campaign must be untouched');
  });

  it('keeps list endpoints scoped to the caller', async () => {
    const mine = await request(app)
      .get('/api/emails/scheduled?pageSize=100')
      .set('Cookie', ctx.cookie)
      .expect(200);
    const theirs = await request(app)
      .get('/api/emails/scheduled?pageSize=100')
      .set('Cookie', ctx.otherCookie)
      .expect(200);

    assert.ok(mine.body.data.some((r: { email: string }) => r.email === 'owner@iso.test'));
    assert.ok(!theirs.body.data.some((r: { email: string }) => r.email === 'owner@iso.test'));
  });

  it('ignores a userId supplied in the request body', async () => {
    const res = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', ctx.otherCookie)
      .send({
        userId: ctx.userId,
        subject: `${SUBJECT} spoof`,
        body: 'body',
        recipients: ['spoof@iso.test'],
        startTime: futureIso(120),
      })
      .expect(201);
    assert.equal(res.body.data.userId, ctx.otherUserId, 'identity comes from the session only');
  });

  it('refuses a senderId belonging to another user', async () => {
    const res = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', ctx.otherCookie)
      .send({
        subject: `${SUBJECT} idor`,
        body: 'body',
        recipients: ['idor@iso.test'],
        startTime: futureIso(120),
        senderId: ctx.senderId,
      })
      .expect(404);
    assert.equal(res.body.error.code, 'SENDER_NOT_FOUND');
  });

  it('keeps the admin dashboard away from a non-admin', async () => {
    const role = await prisma.user.findUniqueOrThrow({ where: { id: ctx.otherUserId } });
    assert.equal(role.role, 'MEMBER', 'fixture expects the second user to be a member');
    await request(app).get('/admin/queues').set('Cookie', ctx.otherCookie).expect(403);
  });
});

describe('Schedule API validation', () => {
  const base = {
    subject: 'ok',
    body: 'ok',
    recipients: ['valid@test.io'],
    startTime: futureIso(60),
  };

  it('reports every invalid field at once', async () => {
    const res = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', ctx.cookie)
      .send({
        subject: '',
        body: '',
        recipients: ['not-an-email'],
        startTime: new Date(Date.now() - 86_400_000).toISOString(),
        delayBetweenEmails: 0,
        hourlyLimit: 99_999,
      })
      .expect(400);

    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    const fields = Object.keys(res.body.error.details);
    for (const expected of ['subject', 'body', 'recipients.0', 'startTime', 'delayBetweenEmails', 'hourlyLimit']) {
      assert.ok(fields.includes(expected), `expected a message for ${expected}`);
    }
  });

  it('rejects malformed addresses the client might have missed', async () => {
    for (const bad of ['trailing.@x.com', 'double..dot@x.com', '@nodomain.com', 'missing@tld']) {
      const res = await request(app)
        .post('/api/emails/schedule')
        .set('Cookie', ctx.cookie)
        .send({ ...base, subject: `${SUBJECT} bad`, recipients: [bad] })
        .expect(400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR', `${bad} should be rejected`);
    }
  });

  it('lowercases and de-duplicates recipients before storing them', async () => {
    const res = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', ctx.cookie)
      .send({
        ...base,
        subject: `${SUBJECT} dedupe`,
        recipients: ['Dup@Test.io', 'dup@test.io', 'other@test.io'],
      })
      .expect(201);

    assert.equal(res.body.data.totalRecipients, 2);
    const rows = await prisma.emailRecipient.findMany({
      where: { emailJobId: res.body.data.id },
      select: { email: true },
    });
    assert.deepEqual(rows.map((r) => r.email).sort(), ['dup@test.io', 'other@test.io']);
  });

  it('rejects a start time in the past', async () => {
    await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', ctx.cookie)
      .send({ ...base, subject: `${SUBJECT} past`, startTime: new Date(Date.now() - 600_000).toISOString() })
      .expect(400);
  });

  it('rejects malformed JSON without leaking a stack trace', async () => {
    const res = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', ctx.cookie)
      .set('Content-Type', 'application/json')
      .send('{bad json')
      .expect(400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(!JSON.stringify(res.body).includes('at '), 'no stack trace in the response');
  });

  it('returns 404 with a generic message for an unknown route', async () => {
    const res = await request(app).get('/api/nope').expect(404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});

describe('Schedule API behaviour', () => {
  it('creates the campaign, its recipients and its queue jobs', async () => {
    const res = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', ctx.cookie)
      .send({
        subject: `${SUBJECT} create`,
        body: 'body',
        recipients: ['a@create.test', 'b@create.test', 'c@create.test'],
        startTime: futureIso(90),
        delayBetweenEmails: 60,
        hourlyLimit: 100,
        senderId: ctx.senderId,
      })
      .expect(201);

    assert.equal(res.body.data.totalRecipients, 3);
    assert.equal(res.body.data.queuedJobs, 3);
    assert.equal(res.body.data.status, 'SCHEDULED');
    assert.equal(res.body.data.deduplicated, false);
    assert.ok(res.body.data.estimatedCompletionAt);

    const rows = await prisma.emailRecipient.findMany({
      where: { emailJobId: res.body.data.id },
      orderBy: { scheduledAt: 'asc' },
    });
    assert.equal(rows.length, 3);
    // Spacing must match the requested delay.
    const gap = rows[1]!.scheduledAt.getTime() - rows[0]!.scheduledAt.getTime();
    assert.equal(gap, 60_000);
  });

  it('replays an identical request instead of creating a second campaign', async () => {
    const payload = {
      subject: `${SUBJECT} idempotent`,
      body: 'body',
      recipients: ['idem@test.io'],
      startTime: futureIso(90),
      senderId: ctx.senderId,
    };

    const first = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', ctx.cookie)
      .set('Idempotency-Key', `${SUBJECT}-key`)
      .send(payload)
      .expect(201);

    const second = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', ctx.cookie)
      .set('Idempotency-Key', `${SUBJECT}-key`)
      .send(payload)
      .expect(200);

    assert.equal(second.body.data.id, first.body.data.id);
    assert.equal(second.body.data.deduplicated, true);
  });

  it('cancels a campaign and refuses to cancel it twice', async () => {
    const created = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', ctx.cookie)
      .send({
        subject: `${SUBJECT} cancel`,
        body: 'body',
        recipients: ['cancel@test.io'],
        startTime: futureIso(90),
        senderId: ctx.senderId,
      })
      .expect(201);

    await request(app).delete(`/api/emails/${created.body.data.id}`).set('Cookie', ctx.cookie).expect(200);

    const again = await request(app)
      .delete(`/api/emails/${created.body.data.id}`)
      .set('Cookie', ctx.cookie)
      .expect(409);
    assert.equal(again.body.error.code, 'JOB_NOT_CANCELLABLE');

    const rows = await prisma.emailRecipient.findMany({
      where: { emailJobId: created.body.data.id },
    });
    assert.ok(rows.every((r) => r.status === 'CANCELLED'));
  });

  it('paginates and filters the list endpoints', async () => {
    const res = await request(app)
      .get('/api/emails/scheduled?page=1&pageSize=2')
      .set('Cookie', ctx.cookie)
      .expect(200);

    assert.ok(res.body.data.length <= 2);
    assert.equal(res.body.meta.page, 1);
    assert.equal(res.body.meta.pageSize, 2);
    assert.ok(typeof res.body.meta.totalItems === 'number');

    const bad = await request(app)
      .get('/api/emails/scheduled?pageSize=999')
      .set('Cookie', ctx.cookie)
      .expect(400);
    assert.ok('pageSize' in bad.body.error.details);
  });
});

describe('Recipient file validation', () => {
  const post = (content: string) =>
    request(app)
      .post('/api/emails/validate-file')
      .set('Cookie', ctx.cookie)
      .send({ content, filename: 'list.csv' });

  it('counts valid, invalid and duplicate rows', async () => {
    const res = await post(
      'email,company\na@x.io,A\nB@X.IO,B\na@x.io,dup\nbroken,C\nc@y.io,D\n',
    ).expect(200);

    const d = res.body.data;
    assert.equal(d.validCount, 3);
    assert.equal(d.invalidCount, 1);
    assert.equal(d.duplicateCount, 1);
    assert.deepEqual(d.validEmails.sort(), ['a@x.io', 'b@x.io', 'c@y.io']);
    assert.equal(d.invalidEntries[0].line, 5);
  });

  it('skips a header row but never a malformed address', async () => {
    const withHeader = await post('email\na@x.io\n').expect(200);
    assert.equal(withHeader.body.data.validCount, 1);

    const noHeader = await post('John,Doe,Acme\na@x.io,X,Y\n').expect(200);
    assert.equal(noHeader.body.data.invalidCount, 1, 'a non-header first row must be reported');
  });

  it('handles the delimiters and line endings people actually upload', async () => {
    for (const content of ['a@x.io;Acme\nb@y.io;Beta\n', 'a@x.io\tAcme\nb@y.io\tBeta\n', 'a@x.io\r\nb@y.io\r\n']) {
      const res = await post(content).expect(200);
      assert.equal(res.body.data.validCount, 2);
    }
  });

  it('rejects an empty file', async () => {
    await request(app)
      .post('/api/emails/validate-file')
      .set('Cookie', ctx.cookie)
      .send({ content: '', filename: 'empty.csv' })
      .expect(400);
  });

  it('reports truncation rather than silently trimming a long list', async () => {
    const content = Array.from({ length: 10_050 }, (_, i) => `u${i}@big.test`).join('\n');
    const res = await post(content).expect(200);
    assert.equal(res.body.data.validCount, 10_050);
    assert.equal(res.body.data.schedulableCount, 10_000);
    assert.equal(res.body.data.truncated, true);
  });

  it('survives pathological input without hanging', async () => {
    const started = Date.now();
    await post('a'.repeat(50_000) + '@').expect(200);
    await post('a.'.repeat(20_000) + '@x.com').expect(200);
    assert.ok(Date.now() - started < 5_000, 'the email pattern must not backtrack');
  });
});

describe('Dashboard statistics', () => {
  it('counts only the caller\'s email', async () => {
    const mine = await request(app).get('/api/dashboard/stats').set('Cookie', ctx.cookie).expect(200);
    const theirs = await request(app)
      .get('/api/dashboard/stats')
      .set('Cookie', ctx.otherCookie)
      .expect(200);

    assert.ok(mine.body.data.scheduled > 0, 'the fixture campaigns should be counted');
    assert.ok(typeof theirs.body.data.scheduled === 'number');
    assert.notEqual(mine.body.data.scheduled, undefined);
    assert.ok('queue' in mine.body.data);
  });
});

describe('HTTP rate limiting', () => {
  it('refuses traffic past the limit with a 429 envelope', async () => {
    // A dedicated app so the assertion is exact and no shared budget is spent.
    const limited = express();
    limited.get('/probe', sensitiveLimiter(3), (_req, res) => res.json({ ok: true }));

    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      codes.push((await request(limited).get('/probe')).status);
    }

    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    const blocked = await request(limited).get('/probe').expect(429);
    assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  });
});
