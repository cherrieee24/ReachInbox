import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { getSearchClient } from '../src/config/elasticsearch.js';
import { searchConfig } from '../src/config/env.js';
import { disconnectDatabase, prisma } from '../src/config/prisma.js';
import { closeRedisConnections } from '../src/config/redis.js';
import { closeEmailQueue } from '../src/queues/email.queue.js';
import { scheduleEmails } from '../src/services/email.service.js';
import {
  ensureIndex,
  indexEmailJob,
  removeFromIndex,
  searchEmails,
} from '../src/services/search.service.js';
import { cleanupBySubject, futureIso, setupContext, tag, tagPrefix, type TestContext } from './helpers.js';

/**
 * Indexing and search against the real Elasticsearch from docker-compose.
 *
 * Runs against its own index. The application index accumulates documents
 * from ordinary use, so asserting exact hit counts against it would make these
 * tests depend on whatever else happens to be indexed.
 */
process.env.ELASTICSEARCH_INDEX = `reachinbox-emails-test-${process.pid}`;

const SUBJECT = tag('search');
let ctx: TestContext;
let mineJobId = '';
let theirsJobId = '';

async function refresh(): Promise<void> {
  await getSearchClient().indices.refresh({ index: searchConfig().index });
}

before(async () => {
  ctx = await setupContext();
  await cleanupBySubject(tagPrefix('search'));
  await ensureIndex();

  const mine = await scheduleEmails(ctx.userId, {
    subject: `${SUBJECT} quarterly newsletter`,
    body: 'body',
    recipients: ['priya.sharma@northwind.io', 'daniel@acmecorp.com'],
    startTime: new Date(futureIso(120)),
    delayBetweenEmails: 60,
    hourlyLimit: 100,
    senderId: ctx.senderId,
  });
  mineJobId = mine.id;

  // The same address for another user, so isolation is actually exercised.
  const theirs = await scheduleEmails(ctx.otherUserId, {
    subject: `${SUBJECT} quarterly newsletter`,
    body: 'body',
    recipients: ['priya.sharma@northwind.io', 'private@theirs.test'],
    startTime: new Date(futureIso(120)),
    delayBetweenEmails: 60,
    hourlyLimit: 100,
    senderId: ctx.otherSenderId,
  });
  theirsJobId = theirs.id;

  await indexEmailJob(mineJobId);
  await indexEmailJob(theirsJobId);
  await refresh();
});

after(async () => {
  // Wildcard: a crashed run leaves its index behind under another pid.
  await getSearchClient()
    .indices.delete({ index: 'reachinbox-emails-test-*' })
    .catch(() => undefined);
  await cleanupBySubject(tagPrefix('search'));
  await closeEmailQueue();
  await closeRedisConnections();
  await disconnectDatabase();
});

describe('Elasticsearch indexing', () => {
  it('indexes every recipient of a campaign with the full field set', async () => {
    const client = getSearchClient();
    const found = await client.search({
      index: searchConfig().index,
      query: { term: { emailJobId: mineJobId } },
    });

    const hits = found.hits.hits;
    assert.equal(hits.length, 2);
    const doc = hits[0]!._source as Record<string, unknown>;
    for (const field of [
      'recipientId', 'emailJobId', 'userId', 'senderId',
      'email', 'subject', 'status', 'scheduledAt', 'sentAt',
    ]) {
      assert.ok(field in doc, `document is missing ${field}`);
    }
  });

  it('reflects a status change on reindex', async () => {
    const row = await prisma.emailRecipient.findFirstOrThrow({ where: { emailJobId: mineJobId } });
    await prisma.emailRecipient.update({
      where: { id: row.id },
      data: { status: 'SENT', sentAt: new Date() },
    });
    await indexEmailJob(mineJobId);
    await refresh();

    const sent = await searchEmails({
      userId: ctx.userId, query: 'quarterly', status: 'SENT', page: 1, pageSize: 10,
    });
    assert.equal(sent.total, 1);
    assert.equal(sent.hits[0]!.recipientId, row.id);

    // Put it back so later assertions see a consistent fixture.
    await prisma.emailRecipient.update({
      where: { id: row.id },
      data: { status: 'SCHEDULED', sentAt: null },
    });
    await indexEmailJob(mineJobId);
    await refresh();
  });

  it('removes documents when asked', async () => {
    const row = await prisma.emailRecipient.findFirstOrThrow({ where: { emailJobId: theirsJobId } });
    await removeFromIndex([row.id]);
    await refresh();

    const client = getSearchClient();
    const found = await client.count({
      index: searchConfig().index,
      query: { term: { recipientId: row.id } },
    });
    assert.equal(found.count, 0);

    await indexEmailJob(theirsJobId);
    await refresh();
  });
});

describe('Elasticsearch search', () => {
  const search = (query: string, userId = ctx.userId, status?: string) =>
    searchEmails({ userId, query, status, page: 1, pageSize: 20 });

  it('matches a partial local part and a partial domain', async () => {
    assert.equal((await search('priya')).total, 1);
    assert.equal((await search('northwind')).total, 1);
  });

  it('matches on subject', async () => {
    assert.equal((await search('newsletter')).total, 2);
  });

  it('keeps an exact address from matching unrelated recipients', async () => {
    // Both addresses share the "com"/"io" style token, so a loose OR match
    // would return the other recipient too.
    const res = await search('daniel@acmecorp.com');
    assert.equal(res.total, 1);
    assert.equal(res.hits[0]!.email, 'daniel@acmecorp.com');
  });

  it('supports typeahead prefixes', async () => {
    assert.ok((await search('newslet')).total >= 1);
  });

  it('filters by status', async () => {
    assert.equal((await search('newsletter', ctx.userId, 'SCHEDULED')).total, 2);
    assert.equal((await search('newsletter', ctx.userId, 'FAILED')).total, 0);
  });

  it('never returns another user\'s email, even for a shared address', async () => {
    const mine = await search('priya');
    const theirs = await search('priya', ctx.otherUserId);

    assert.equal(mine.total, 1);
    assert.equal(theirs.total, 1);
    assert.notEqual(mine.hits[0]!.recipientId, theirs.hits[0]!.recipientId);
    assert.equal(mine.hits[0]!.userId, ctx.userId);
    assert.equal(theirs.hits[0]!.userId, ctx.otherUserId);

    // And the private one is invisible to the first user.
    assert.equal((await search('private@theirs.test')).total, 0);
    assert.equal((await search('private@theirs.test', ctx.otherUserId)).total, 1);
  });

  it('reports the index as the source when Elasticsearch answers', async () => {
    assert.equal((await search('newsletter')).source, 'elasticsearch');
  });
});

describe('Search degradation', () => {
  it('falls back to PostgreSQL when the index is unreachable', async () => {
    const original = process.env.ELASTICSEARCH_NODE;
    // Point the client at a closed port and force a fresh connection.
    process.env.ELASTICSEARCH_NODE = 'http://127.0.0.1:9';
    const { closeSearchClient, markSearchAvailable } = await import('../src/config/elasticsearch.js');
    await closeSearchClient();
    markSearchAvailable();

    try {
      const res = await searchEmails({
        userId: ctx.userId, query: 'newsletter', page: 1, pageSize: 20,
      });
      assert.equal(res.source, 'database', 'search must keep working without the index');
      assert.equal(res.total, 2, 'the database returns the same rows');
    } finally {
      process.env.ELASTICSEARCH_NODE = original;
      await closeSearchClient();
      markSearchAvailable();
    }
  });
});
