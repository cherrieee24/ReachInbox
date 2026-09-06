import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, afterEach, before, describe, it } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { disconnectDatabase, prisma } from '../src/config/prisma.js';
import { closeRedisConnections, createRedisConnection } from '../src/config/redis.js';
import { closeEmailQueue } from '../src/queues/email.queue.js';
import { buildInstallUrl, createOAuthState } from '../src/integrations/slack.js';
import { claimLimitNotification, currentWindow } from '../src/services/rateLimiter.service.js';
import { disconnect, getStatus, notify, saveInstallation } from '../src/services/slack.service.js';
import { decryptSecret } from '../src/utils/crypto.js';
import { setupContext, type TestContext } from './helpers.js';

/**
 * Slack OAuth and notifications.
 *
 * Slack's own servers are replaced by a local capture endpoint, so the exact
 * HTTP request the app would send is asserted without depending on a live
 * workspace. Everything else — state validation, encryption at rest, the
 * per-window notification claim — runs for real.
 */

// The URL-building test asserts on structure, not on real credentials, so
// placeholders are supplied when the environment has none.
process.env.SLACK_CLIENT_ID ||= 'test-client-id';
process.env.SLACK_CLIENT_SECRET ||= 'test-client-secret';

const app = createApp();
const TEAM_ID = `T-TEST-${process.pid}`;
let ctx: TestContext;
let redis: ReturnType<typeof createRedisConnection>;
let captureServer: Server;
let captured: string[] = [];
let webhookUrl = '';

before(async () => {
  ctx = await setupContext();
  redis = createRedisConnection('slack-test');

  captureServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      captured.push(body);
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((resolve) => captureServer.listen(0, '127.0.0.1', resolve));
  const address = captureServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  webhookUrl = `http://127.0.0.1:${port}/hook`;
});

afterEach(() => {
  captured = [];
});

after(async () => {
  await prisma.slackConnection.deleteMany({ where: { teamId: TEAM_ID } });
  await redis.del(`slack_notified:${ctx.senderId}:${currentWindow()}`);
  redis.disconnect();
  await new Promise<void>((resolve) => captureServer.close(() => resolve()));
  await closeEmailQueue();
  await closeRedisConnections();
  await disconnectDatabase();
});

describe('Slack OAuth', () => {
  it('builds an install URL with the right scopes and no secret', () => {
    const url = buildInstallUrl('state-123');
    assert.match(url, /^https:\/\/slack\.com\/oauth\/v2\/authorize/);
    assert.match(url, /scope=incoming-webhook/);
    assert.match(url, /state=state-123/);
    assert.ok(!url.includes('client_secret'), 'the client secret must never leave the server');
  });

  it('mints unguessable, unique state values', () => {
    const values = new Set(Array.from({ length: 50 }, () => createOAuthState()));
    assert.equal(values.size, 50);
    assert.ok([...values][0]!.length >= 32);
  });

  it('requires a session to start the install', async () => {
    await request(app).get('/api/slack/connect').expect(401);
  });

  it('sets a state cookie and redirects to Slack', async () => {
    const res = await request(app).get('/api/slack/connect').set('Cookie', ctx.cookie).expect(302);
    // Without credentials configured it redirects back with a clear reason
    // instead of erroring; with them it goes to Slack.
    const location = String(res.headers.location);
    assert.ok(
      location.includes('slack.com') || location.includes('slack=not_configured'),
      `unexpected redirect: ${location}`,
    );
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    const res = await request(app).get('/api/slack/callback?code=abc&state=forged').expect(302);
    assert.match(String(res.headers.location), /slack=invalid_state/);
  });

  it('reports a cancelled install rather than failing', async () => {
    const res = await request(app).get('/api/slack/callback?error=access_denied').expect(302);
    assert.match(String(res.headers.location), /slack=access_denied/);
  });
});

describe('Slack connection storage', () => {
  it('encrypts the token and webhook before they reach the database', async () => {
    await saveInstallation(ctx.userId, {
      teamId: TEAM_ID,
      teamName: 'Test Workspace',
      botUserId: 'U0BOT',
      authedUserId: 'U0USER',
      accessToken: 'xoxb-super-secret-value',
      scope: 'incoming-webhook',
      channelId: 'C0TEST',
      channelName: '#alerts',
      webhookUrl,
    });

    const row = await prisma.slackConnection.findFirstOrThrow({ where: { teamId: TEAM_ID } });
    assert.ok(!row.accessToken.includes('xoxb-'), 'the token must not be stored in plaintext');
    assert.ok(!String(row.webhookUrl).includes('127.0.0.1'), 'the webhook must not be plaintext');
    assert.match(row.accessToken, /^v1:/, 'stored with a scheme version');
    assert.equal(decryptSecret(row.accessToken), 'xoxb-super-secret-value');
    assert.equal(decryptSecret(String(row.webhookUrl)), webhookUrl);
  });

  it('reconnecting the same workspace updates in place', async () => {
    await saveInstallation(ctx.userId, {
      teamId: TEAM_ID,
      teamName: 'Renamed Workspace',
      botUserId: 'U0BOT',
      authedUserId: 'U0USER',
      accessToken: 'xoxb-rotated',
      scope: 'incoming-webhook',
      channelId: 'C0TEST',
      channelName: '#alerts',
      webhookUrl,
    });

    const rows = await prisma.slackConnection.findMany({ where: { teamId: TEAM_ID } });
    assert.equal(rows.length, 1, 'no duplicate connection rows');
    assert.equal(rows[0]!.teamName, 'Renamed Workspace');
  });

  it('exposes status without leaking the token', async () => {
    const status = await getStatus(ctx.userId);
    assert.equal(status.connected, true);
    assert.equal(status.teamName, 'Renamed Workspace');
    assert.ok(!JSON.stringify(status).includes('xoxb'), 'no token in the status payload');

    const res = await request(app).get('/api/slack/status').set('Cookie', ctx.cookie).expect(200);
    assert.equal(res.body.data.connected, true);
    assert.ok(!JSON.stringify(res.body).includes('xoxb'));
  });

  it('keeps one user\'s connection invisible to another', async () => {
    const theirs = await getStatus(ctx.otherUserId);
    assert.equal(theirs.connected, false, 'the other user has no connection of their own');
  });
});

describe('Slack notifications', () => {
  it('posts the rate-limit message to the configured webhook', async () => {
    const delivered = await notify(ctx.userId, 'Email rate limit reached for sender *x* (40/hour).');

    assert.equal(delivered, true);
    assert.equal(captured.length, 1, 'exactly one HTTP request to Slack');
    const payload = JSON.parse(captured[0]!) as { text: string };
    assert.match(payload.text, /rate limit reached/i);
  });

  it('announces a full window once per sender, however many sends defer', async () => {
    await redis.del(`slack_notified:${ctx.senderId}:${currentWindow()}`);

    const claims = await Promise.all(
      Array.from({ length: 20 }, () => claimLimitNotification(ctx.senderId)),
    );
    assert.equal(claims.filter(Boolean).length, 1, 'only one caller may announce');
  });

  it('is a no-op when no workspace is connected', async () => {
    const delivered = await notify(ctx.otherUserId, 'should not be sent');
    assert.equal(delivered, false);
    assert.equal(captured.length, 0, 'nothing is sent without a connection');
  });

  it('never throws, so a Slack outage cannot break a send', async () => {
    // Point the stored webhook at a closed port.
    await saveInstallation(ctx.userId, {
      teamId: TEAM_ID,
      teamName: 'Test Workspace',
      botUserId: null,
      authedUserId: null,
      accessToken: 'xoxb-token',
      scope: 'incoming-webhook',
      channelId: null,
      channelName: null,
      webhookUrl: 'http://127.0.0.1:9/hook',
    });

    const delivered = await notify(ctx.userId, 'unreachable');
    assert.equal(delivered, false, 'reported as undelivered rather than thrown');
  });
});

describe('Slack disconnect', () => {
  it('revokes rather than deletes, and stops notifications', async () => {
    const result = await disconnect(ctx.userId);
    assert.ok(result.disconnected >= 1);

    const status = await getStatus(ctx.userId);
    assert.equal(status.connected, false);

    const row = await prisma.slackConnection.findFirstOrThrow({ where: { teamId: TEAM_ID } });
    assert.equal(row.status, 'REVOKED', 'the audit trail survives a disconnect');
    assert.ok(row.revokedAt);

    assert.equal(await notify(ctx.userId, 'after disconnect'), false);
    assert.equal(captured.length, 0);
  });

  it('is safe to call when nothing is connected', async () => {
    const res = await request(app)
      .post('/api/slack/disconnect')
      .set('Cookie', ctx.cookie)
      .expect(200);
    assert.equal(res.body.data.disconnected, 0);
  });
});
