import { setTimeout as sleep } from 'node:timers/promises';
import { getSearchClient } from '../src/config/elasticsearch.js';
import { searchConfig } from '../src/config/env.js';
import { disconnectDatabase, prisma } from '../src/config/prisma.js';
import { closeRedisConnections, createRedisConnection } from '../src/config/redis.js';
import { closeEmailQueue, getQueueCounts } from '../src/queues/email.queue.js';
import { currentWindow, windowEndsAt } from '../src/services/rateLimiter.service.js';
import { signSessionToken } from '../src/utils/jwt.js';

/**
 * Load test for the scheduler.
 *
 * Sends go to Ethereal, which captures mail and never delivers it, so nothing
 * reaches a real inbox. The hourly rate limit is also left in force: with a
 * campaign limit of N, only N of the thousand recipients are actually
 * transmitted in the current window and the rest are deferred — which is both
 * the safety property and the behaviour under test.
 *
 * Nothing here bypasses or weakens the production path. Campaigns are created
 * through the real HTTP API, and every observation is a read of PostgreSQL,
 * Redis or Elasticsearch.
 *
 * Two independent mechanisms cap throughput, and the test targets the second:
 *
 *   1. Schedule-time spreading. `computeSendTime` already pushes recipient N
 *      past the hour boundary when N exceeds the *campaign's* hourlyLimit, so
 *      a low campaign limit means those recipients are never due in this
 *      window and the runtime limiter never sees them.
 *   2. The runtime throttle. `MAX_EMAILS_PER_HOUR` is the server-wide ceiling
 *      per sender, enforced in Redis when a job actually runs.
 *
 * To exercise (2) — the scenario "1000 emails scheduled for approximately the
 * same time" — the campaign limit is left high so the recipients really are
 * all due, and the server ceiling becomes the binding constraint.
 *
 *   MAX_EMAILS_PER_HOUR=40 npm run load-test -- --recipients 1000 --watch 120
 */

interface Options {
  recipients: number;
  hourlyLimit: number;
  delayBetweenEmails: number;
  watchSeconds: number;
  apiUrl: string;
  keep: boolean;
  concurrentProbes: number;
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string, fallback: string): string => {
    const index = argv.indexOf(`--${flag}`);
    return index >= 0 && argv[index + 1] ? (argv[index + 1] as string) : fallback;
  };
  return {
    recipients: Number(get('recipients', '1000')),
    // Deliberately high: a low campaign limit would spread recipients across
    // future windows at schedule time, so the runtime throttle would never be
    // reached. The server ceiling is what this test is measuring.
    hourlyLimit: Number(get('campaign-limit', '2000')),
    delayBetweenEmails: Number(get('delay', '1')),
    watchSeconds: Number(get('watch', '90')),
    apiUrl: get('api', 'http://localhost:4000'),
    keep: argv.includes('--keep'),
    concurrentProbes: Number(get('probes', '20')),
  };
}

const SUBJECT = `loadtest-${Date.now()}`;

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] as number;
}

function line(): void {
  console.log('─'.repeat(72));
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run a load test against production.');
  }

  const options = parseArgs(process.argv.slice(2));
  const minDelayMs = Number(process.env.MIN_EMAIL_DELAY_MS ?? process.env.EMAIL_MIN_DELAY_MS ?? 1000);
  const serverHourlyCeiling = Number(process.env.MAX_EMAILS_PER_HOUR ?? 100);
  const effectiveLimit = Math.min(options.hourlyLimit, serverHourlyCeiling);

  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!user) throw new Error('No user found — sign in once with Google first.');
  const sender = await prisma.sender.findFirst({ where: { userId: user.id } });
  if (!sender) throw new Error('No sender found — run `npm run db:seed` first.');

  const cookie = `reachinbox_session=${signSessionToken({ sub: user.id, email: user.email })}`;
  const redis = createRedisConnection('load-test');

  line();
  console.log('ReachInbox scheduler load test');
  line();
  console.log(`  recipients          ${options.recipients}`);
  console.log(`  campaign limit      ${options.hourlyLimit}/hour  (schema max, so none are spread at schedule time)`);
  console.log(`  server ceiling      ${serverHourlyCeiling}/hour  (MAX_EMAILS_PER_HOUR)`);
  console.log(`  effective limit     ${effectiveLimit}/hour  (the smaller of the two)`);
  console.log(`  min delay           ${minDelayMs} ms between sends`);
  console.log(`  sender              ${sender.fromEmail}`);
  console.log(`  transport           Ethereal (captured, never delivered)`);
  console.log(`  expectation         ~${effectiveLimit} send now, ~${options.recipients - effectiveLimit} defer to the next window`);
  line();

  // ---- 1. Schedule -------------------------------------------------------
  const recipients = Array.from(
    { length: options.recipients },
    (_, i) => `load-${i}@loadtest.invalid`,
  );
  const startTime = new Date(Date.now() + 5_000).toISOString();

  const scheduleStarted = Date.now();
  const response = await fetch(`${options.apiUrl}/api/emails/schedule`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'Idempotency-Key': `load-${SUBJECT}`,
    },
    body: JSON.stringify({
      subject: SUBJECT,
      body: 'Load test message.',
      recipients,
      startTime,
      delayBetweenEmails: options.delayBetweenEmails,
      hourlyLimit: options.hourlyLimit,
      senderId: sender.id,
    }),
  });
  const scheduleMs = Date.now() - scheduleStarted;
  const payload = (await response.json()) as {
    success: boolean;
    data?: { id: string; totalRecipients: number; queuedJobs: number };
    error?: { code: string; message: string };
  };

  if (!payload.success || !payload.data) {
    throw new Error(`Scheduling failed: ${payload.error?.code} ${payload.error?.message}`);
  }
  const jobId = payload.data.id;

  console.log('1. SCHEDULING');
  console.log(`   POST /api/emails/schedule   ${response.status} in ${scheduleMs} ms`);
  console.log(`   recipients stored           ${payload.data.totalRecipients}`);
  console.log(`   jobs enqueued               ${payload.data.queuedJobs}`);
  console.log(`   throughput                  ${Math.round(options.recipients / (scheduleMs / 1000))} recipients/sec`);

  // ---- 2. API responsiveness while the queue drains ----------------------
  console.log('\n2. API RESPONSIVENESS (while workers are busy)');
  const latencies: number[] = [];
  await Promise.all(
    Array.from({ length: options.concurrentProbes }, async () => {
      for (let i = 0; i < 5; i += 1) {
        const started = Date.now();
        const probe = await fetch(`${options.apiUrl}/api/emails/scheduled?pageSize=10`, {
          headers: { Cookie: cookie },
        });
        latencies.push(Date.now() - started);
        if (!probe.ok) console.log(`   probe returned ${probe.status}`);
        await sleep(200);
      }
    }),
  );
  latencies.sort((a, b) => a - b);
  console.log(`   ${latencies.length} concurrent reads during processing`);
  console.log(`   p50 ${pct(latencies, 50)} ms · p95 ${pct(latencies, 95)} ms · max ${latencies[latencies.length - 1]} ms`);

  // ---- 3. Watch the queue drain -----------------------------------------
  console.log('\n3. QUEUE PROCESSING');
  console.log('   elapsed   sent  failed  processing  scheduled |  delayed  active  waiting');
  const deadline = Date.now() + options.watchSeconds * 1000;
  const startedAt = Date.now();
  let budgetSpentAt: number | null = null;

  while (Date.now() < deadline) {
    const [grouped, counts] = await Promise.all([
      prisma.emailRecipient.groupBy({
        by: ['status'],
        where: { emailJobId: jobId },
        _count: { _all: true },
      }),
      getQueueCounts(),
    ]);
    const by = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
    const elapsed = Math.round((Date.now() - startedAt) / 1000);

    console.log(
      `   ${String(elapsed).padStart(5)}s   ` +
        `${String(by.SENT ?? 0).padStart(4)}  ` +
        `${String(by.FAILED ?? 0).padStart(6)}  ` +
        `${String(by.PROCESSING ?? 0).padStart(10)}  ` +
        `${String(by.SCHEDULED ?? 0).padStart(9)} |  ` +
        `${String(counts.delayed).padStart(7)}  ` +
        `${String(counts.active).padStart(6)}  ` +
        `${String(counts.waiting).padStart(7)}`,
    );

    // Once the budget is spent, keep watching briefly: the next due job is
    // what triggers the hour-limit refusal and the Slack notification.
    if ((by.SENT ?? 0) + (by.FAILED ?? 0) >= effectiveLimit && (by.PROCESSING ?? 0) === 0) {
      if (budgetSpentAt === null) {
        budgetSpentAt = Date.now();
        console.log('   (window budget spent — watching for the hour-limit refusal)');
      } else if (Date.now() - budgetSpentAt > 20_000) {
        break;
      }
    }
    await sleep(5_000);
  }

  // ---- 4. Verification ---------------------------------------------------
  console.log('\n4. VERIFICATION');
  const results: [string, boolean, string][] = [];

  const rows = await prisma.emailRecipient.findMany({
    where: { emailJobId: jobId },
    select: {
      email: true,
      status: true,
      sentAt: true,
      scheduledAt: true,
      attempts: true,
      // Set when the send started; the precise record of dispatch pacing.
      lockedAt: true,
    },
    orderBy: { sentAt: 'asc' },
  });

  results.push([
    'PostgreSQL row count matches the request',
    rows.length === options.recipients,
    `${rows.length}/${options.recipients}`,
  ]);

  const unique = new Set(rows.map((r) => r.email));
  results.push([
    'no duplicate recipients',
    unique.size === rows.length,
    `${unique.size} unique`,
  ]);

  const sent = rows.filter((r) => r.sentAt);
  const windowEnd = windowEndsAt();
  const sentThisWindow = sent.filter((r) => (r.sentAt as Date).getTime() < windowEnd);
  results.push([
    'hourly rate limit respected',
    sentThisWindow.length <= effectiveLimit,
    `${sentThisWindow.length} sent ≤ ${effectiveLimit} allowed`,
  ]);

  /*
   * The throttle paces when a send *starts*, so dispatch times are what the
   * guarantee is about. `sentAt` records completion, and completions overlap
   * under concurrency — measuring those would test the wrong thing.
   */
  const starts = sent
    .map((r) => r.lockedAt?.getTime())
    .filter((t): t is number => typeof t === 'number')
    .sort((a, b) => a - b);

  let tooClose = 0;
  let smallestGap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < starts.length; i += 1) {
    const gap = (starts[i] as number) - (starts[i - 1] as number);
    smallestGap = Math.min(smallestGap, gap);
    if (gap < minDelayMs - 50) tooClose += 1;
  }

  const completions = sent.map((r) => (r.sentAt as Date).getTime()).sort((a, b) => a - b);
  let closestCompletion = Number.POSITIVE_INFINITY;
  for (let i = 1; i < completions.length; i += 1) {
    closestCompletion = Math.min(
      closestCompletion,
      (completions[i] as number) - (completions[i - 1] as number),
    );
  }

  results.push([
    'minimum delay respected between dispatches',
    starts.length < 2 || tooClose === 0,
    starts.length > 1
      ? `smallest dispatch gap ${smallestGap} ms ≥ ${minDelayMs} ms` +
        ` (closest completion ${closestCompletion} ms — overlaps under concurrency, as expected)`
      : 'too few sends to measure',
  ]);

  const deferred = rows.filter((r) => r.status === 'SCHEDULED' || r.status === 'PENDING');
  results.push([
    'excess emails rescheduled rather than dropped',
    deferred.length + sent.length + rows.filter((r) => r.status === 'FAILED').length === rows.length,
    `${deferred.length} deferred, ${sent.length} sent`,
  ]);

  const deferredIntoNextWindow = deferred.filter((r) => r.scheduledAt.getTime() >= windowEnd);
  results.push([
    'deferred work moved into a later window',
    deferred.length === 0 || deferredIntoNextWindow.length > 0,
    `${deferredIntoNextWindow.length}/${deferred.length} past ${new Date(windowEnd).toISOString()}`,
  ]);

  const failed = rows.filter((r) => r.status === 'FAILED');
  const retried = rows.filter((r) => r.attempts > 1);
  results.push(['no failed sends', failed.length === 0, `${failed.length} failed, ${retried.length} retried`]);

  // Redis: every non-terminal row should still be represented in the queue.
  const counts = await getQueueCounts();
  const inQueue = counts.delayed + counts.waiting + counts.active;
  results.push([
    'Redis queue consistent with PostgreSQL',
    inQueue >= deferred.length,
    `${inQueue} queued ≥ ${deferred.length} pending rows`,
  ]);

  // Redis rate-limit counter for this sender.
  const rateKey = `email_rate:${sender.id}:${currentWindow()}`;
  const used = Number((await redis.get(rateKey)) ?? 0);
  results.push([
    'Redis rate counter matches sends',
    used <= effectiveLimit,
    `counter ${used} ≤ ${effectiveLimit}`,
  ]);

  // Elasticsearch catches up asynchronously.
  let indexed = 0;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const client = getSearchClient();
      await client.indices.refresh({ index: searchConfig().index });
      const counted = await client.count({
        index: searchConfig().index,
        query: { term: { emailJobId: jobId } },
      });
      indexed = counted.count;
      if (indexed >= options.recipients) break;
    } catch {
      break;
    }
    await sleep(2_000);
  }
  results.push([
    'Elasticsearch eventually indexed the campaign',
    indexed >= options.recipients,
    `${indexed}/${options.recipients} documents`,
  ]);

  // Slack: was the rate-limit notification claimed for this window?
  const notifyKey = `slack_notified:${sender.id}:${currentWindow()}`;
  const claimed = (await redis.get(notifyKey)) !== null;
  const connection = await prisma.slackConnection.findFirst({
    where: { userId: user.id, status: 'ACTIVE' },
  });
  results.push([
    'Slack rate-limit notification',
    connection ? claimed : true,
    connection
      ? claimed
        ? 'sent once for this window'
        : 'NOT sent — the hourly limit was never reached at runtime'
      : 'skipped — no Slack workspace connected',
  ]);

  for (const [label, ok, detail] of results) {
    console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(48)} ${detail}`);
  }

  const failures = results.filter(([, ok]) => !ok).length;

  line();
  console.log(`  ${results.length - failures}/${results.length} checks passed`);
  console.log(`  scheduling API: ${scheduleMs} ms for ${options.recipients} recipients`);
  console.log(`  reads under load: p50 ${pct(latencies, 50)} ms, p95 ${pct(latencies, 95)} ms`);
  line();

  if (options.keep) {
    console.log(`\nCampaign ${jobId} kept for inspection (subject "${SUBJECT}").`);
    console.log('Remove it with: npm run load-test:clean');
  } else {
    await prisma.emailJob.delete({ where: { id: jobId } });
    console.log('\nCampaign removed. Pass --keep to leave it in place.');
  }

  redis.disconnect();
  process.exitCode = failures > 0 ? 1 : 0;
}

main()
  .catch((error: unknown) => {
    console.error('\nLoad test failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeEmailQueue().catch(() => undefined);
    await closeRedisConnections().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);
    process.exit();
  });
