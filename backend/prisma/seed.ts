import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client.js';

dotenv.config();

/**
 * Local development seed. Attaches a sender and one sample campaign to the
 * first real (Google-authenticated) user so the dashboard has something to
 * render. Safe to run repeatedly — every write is keyed on a unique constraint.
 *
 * Refuses to run against production.
 */

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Mirrors the runtime rule: one stable key per (job, address). */
function idempotencyKey(jobId: string, email: string): string {
  return createHash('sha256').update(`${jobId}:${email.toLowerCase()}`).digest('hex').slice(0, 40);
}

const SAMPLE_RECIPIENTS = [
  'priya.sharma@northwind.io',
  'daniel.reyes@acmecorp.com',
  'm.okafor@brightlayer.co',
  'sofia@lumenanalytics.com',
  'hello@fernwoodlabs.dev',
];

async function main(): Promise<void> {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });

  if (!user) {
    console.log('No users yet — sign in with Google once, then re-run the seed.');
    return;
  }
  console.log(`Seeding for ${user.email}`);

  const sender = await prisma.sender.upsert({
    where: { userId_fromEmail: { userId: user.id, fromEmail: 'dev@reachinbox.local' } },
    create: {
      userId: user.id,
      name: 'ReachInbox Dev',
      fromEmail: 'dev@reachinbox.local',
      provider: 'ETHEREAL',
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      isDefault: true,
      isVerified: true,
      verifiedAt: new Date(),
    },
    update: {},
  });
  console.log(`  sender: ${sender.fromEmail}`);

  // One campaign per seeded user, identified by its subject.
  const existing = await prisma.emailJob.findFirst({
    where: { userId: user.id, subject: 'Quick question about your outbound stack' },
  });

  if (existing) {
    console.log('  campaign already seeded — nothing to do');
    return;
  }

  const startsAt = new Date(Date.now() + 60 * 60 * 1000);
  const delaySeconds = 30;

  const job = await prisma.emailJob.create({
    data: {
      userId: user.id,
      senderId: sender.id,
      subject: 'Quick question about your outbound stack',
      body: 'Hi there,\n\nI noticed your team is scaling outbound and thought ReachInbox might help.\n\n— Aarav',
      scheduledAt: startsAt,
      delayBetweenEmails: delaySeconds,
      hourlyLimit: 100,
      status: 'SCHEDULED',
      totalRecipients: SAMPLE_RECIPIENTS.length,
    },
  });

  await prisma.emailRecipient.createMany({
    data: SAMPLE_RECIPIENTS.map((email, index) => ({
      emailJobId: job.id,
      userId: user.id,
      email,
      // Same spacing the scheduler will apply once the queue exists.
      scheduledAt: new Date(startsAt.getTime() + index * delaySeconds * 1000),
      status: 'SCHEDULED' as const,
      idempotencyKey: idempotencyKey(job.id, email),
    })),
  });

  console.log(`  campaign: ${job.subject} (${SAMPLE_RECIPIENTS.length} recipients)`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
