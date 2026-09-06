import { disconnectDatabase, prisma } from '../src/config/prisma.js';
import { closeEmailQueue, getEmailQueue } from '../src/queues/email.queue.js';
import { closeRedisConnections } from '../src/config/redis.js';

/** Removes load-test campaigns and the queue jobs they left behind. */
async function main(): Promise<void> {
  const rows = await prisma.emailRecipient.findMany({
    where: { emailJob: { subject: { startsWith: 'loadtest-' } } },
    select: { idempotencyKey: true },
  });

  const queue = getEmailQueue();
  for (const row of rows) {
    await (await queue.getJob(row.idempotencyKey))?.remove().catch(() => undefined);
  }

  const { count } = await prisma.emailJob.deleteMany({
    where: { subject: { startsWith: 'loadtest-' } },
  });
  console.log(`Removed ${count} load-test campaign(s) and ${rows.length} queue job(s).`);
}

main()
  .catch((error: unknown) => console.error(error))
  .finally(async () => {
    await closeEmailQueue().catch(() => undefined);
    await closeRedisConnections().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);
    process.exit();
  });
