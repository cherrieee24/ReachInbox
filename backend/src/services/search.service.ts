import { searchConfig } from '../config/env.js';
import { withSearch } from '../config/elasticsearch.js';
import { prisma } from '../config/prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Email search index.
 *
 * PostgreSQL is the source of truth; this index is a projection of it, kept up
 * to date after each state change. Every write is fire-and-forget — a failure
 * is logged and skipped, never propagated to the caller — and `reindexAll()`
 * can rebuild the whole index from the database at any time, so drift is
 * always recoverable.
 */

export interface EmailDocument {
  recipientId: string;
  emailJobId: string;
  userId: string;
  senderId: string;
  email: string;
  subject: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
}

export interface SearchHit extends EmailDocument {
  score: number;
}

function indexName(): string {
  return searchConfig().index;
}

/**
 * The default analyzer splits `priya.sharma@northwind.io` awkwardly, so a
 * custom one tokenises on any non-alphanumeric run. That turns the address
 * into [priya, sharma, northwind, io], which is what makes searching for
 * "priya" or "northwind" find it.
 */
const INDEX_SETTINGS = {
  analysis: {
    tokenizer: {
      email_tokenizer: { type: 'pattern' as const, pattern: '[^A-Za-z0-9]+' },
    },
    analyzer: {
      email_analyzer: {
        type: 'custom' as const,
        tokenizer: 'email_tokenizer',
        filter: ['lowercase'],
      },
    },
  },
};

const INDEX_MAPPINGS = {
  properties: {
    recipientId: { type: 'keyword' as const },
    emailJobId: { type: 'keyword' as const },
    userId: { type: 'keyword' as const },
    senderId: { type: 'keyword' as const },
    email: {
      type: 'text' as const,
      analyzer: 'email_analyzer',
      fields: { raw: { type: 'keyword' as const } },
    },
    subject: {
      type: 'text' as const,
      fields: { raw: { type: 'keyword' as const } },
    },
    status: { type: 'keyword' as const },
    scheduledAt: { type: 'date' as const },
    sentAt: { type: 'date' as const },
  },
};

/** Creates the index if missing. Safe to call on every boot. */
export async function ensureIndex(): Promise<boolean> {
  return withSearch(
    async (client) => {
      const exists = await client.indices.exists({ index: indexName() });
      if (exists) return true;

      await client.indices.create({
        index: indexName(),
        settings: INDEX_SETTINGS,
        mappings: INDEX_MAPPINGS,
      });
      logger.info('Created Elasticsearch index', { index: indexName() });
      return true;
    },
    false,
    { operation: 'ensureIndex' },
  );
}

interface RecipientRow {
  id: string;
  emailJobId: string;
  userId: string;
  email: string;
  status: string;
  scheduledAt: Date;
  sentAt: Date | null;
  emailJob: { subject: string; senderId: string };
}

function toDocument(row: RecipientRow): EmailDocument {
  return {
    recipientId: row.id,
    emailJobId: row.emailJobId,
    userId: row.userId,
    senderId: row.emailJob.senderId,
    email: row.email,
    subject: row.emailJob.subject,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
  };
}

const rowSelect = {
  id: true,
  emailJobId: true,
  userId: true,
  email: true,
  status: true,
  scheduledAt: true,
  sentAt: true,
  emailJob: { select: { subject: true, senderId: true } },
} as const;

/** Indexes every recipient of a campaign, in one bulk call. */
export async function indexEmailJob(emailJobId: string): Promise<number> {
  const rows = await prisma.emailRecipient.findMany({
    where: { emailJobId },
    select: rowSelect,
  });
  return indexRecipients(rows);
}

export async function indexRecipients(rows: RecipientRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  return withSearch(
    async (client) => {
      const operations = rows.flatMap((row) => [
        { index: { _index: indexName(), _id: row.id } },
        toDocument(row),
      ]);

      const response = await client.bulk({ refresh: false, operations });
      if (response.errors) {
        const firstError = response.items.find((item) => item.index?.error)?.index?.error;
        logger.warn('Some documents failed to index', { error: firstError?.reason });
      }
      return rows.length;
    },
    0,
    { operation: 'indexRecipients', count: rows.length },
  );
}

/** Re-indexes one recipient after its status changes. */
export async function indexRecipient(recipientId: string): Promise<void> {
  const row = await prisma.emailRecipient.findUnique({
    where: { id: recipientId },
    select: rowSelect,
  });
  if (!row) return;
  await indexRecipients([row]);
}

/**
 * Fire-and-forget indexing for hot paths (the worker, the schedule endpoint).
 * The caller is never delayed and never fails because of the index.
 */
export function indexRecipientAsync(recipientId: string): void {
  void indexRecipient(recipientId).catch((error: unknown) => {
    logger.warn('Background index failed', { recipientId, error });
  });
}

export function indexEmailJobAsync(emailJobId: string): void {
  void indexEmailJob(emailJobId).catch((error: unknown) => {
    logger.warn('Background index failed', { emailJobId, error });
  });
}

export interface SearchParams {
  /** Always the authenticated user — never taken from input. */
  userId: string;
  query: string;
  status?: string;
  page: number;
  pageSize: number;
}

export interface SearchOutcome {
  hits: SearchHit[];
  total: number;
  /** Which backend answered — the index, or the database fallback. */
  source: 'elasticsearch' | 'database';
}

/**
 * Searches recipient address and subject, filtered by status.
 *
 * The `userId` term filter is not optional and is applied to every query, so a
 * user's search can only ever match their own emails.
 */
export async function searchEmails(params: SearchParams): Promise<SearchOutcome> {
  const from = (params.page - 1) * params.pageSize;

  const filter: Record<string, unknown>[] = [{ term: { userId: params.userId } }];
  if (params.status) filter.push({ term: { status: params.status } });

  const result = await withSearch<SearchOutcome | null>(
    async (client) => {
      const response = await client.search<EmailDocument>({
        index: indexName(),
        from,
        size: params.pageSize,
        query: {
          bool: {
            filter,
            must: [
              {
                bool: {
                  should: [
                    // `and` keeps precision: searching a full address must not
                    // match every other recipient that merely shares its TLD.
                    {
                      multi_match: {
                        query: params.query,
                        fields: ['email^2', 'subject'],
                        operator: 'and' as const,
                      },
                    },
                    // Matches while the user is still typing.
                    {
                      multi_match: {
                        query: params.query,
                        fields: ['email^2', 'subject'],
                        type: 'phrase_prefix',
                      },
                    },
                  ],
                  minimum_should_match: 1,
                },
              },
            ],
          },
        },
        sort: [{ _score: { order: 'desc' } }, { scheduledAt: { order: 'desc' } }],
      });

      const total =
        typeof response.hits.total === 'number'
          ? response.hits.total
          : (response.hits.total?.value ?? 0);

      return {
        hits: response.hits.hits.map((hit) => ({
          ...(hit._source as EmailDocument),
          score: hit._score ?? 0,
        })),
        total,
        source: 'elasticsearch' as const,
      };
    },
    null,
    { operation: 'search' },
  );

  if (result) return result;

  // Index unavailable — answer from the source of truth instead of failing.
  return searchInDatabase(params);
}

/**
 * Fallback search straight against PostgreSQL. Slower and less clever than the
 * index, but it keeps the feature working during an Elasticsearch outage.
 */
async function searchInDatabase(params: SearchParams): Promise<SearchOutcome> {
  const where = {
    userId: params.userId,
    ...(params.status ? { status: params.status as never } : {}),
    OR: [
      { email: { contains: params.query, mode: 'insensitive' as const } },
      { emailJob: { subject: { contains: params.query, mode: 'insensitive' as const } } },
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.emailRecipient.findMany({
      where,
      select: rowSelect,
      orderBy: { scheduledAt: 'desc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.emailRecipient.count({ where }),
  ]);

  return {
    hits: rows.map((row) => ({ ...toDocument(row), score: 0 })),
    total,
    source: 'database',
  };
}

export async function removeFromIndex(recipientIds: string[]): Promise<void> {
  if (recipientIds.length === 0) return;
  await withSearch(
    async (client) => {
      await client.bulk({
        refresh: false,
        operations: recipientIds.map((id) => ({ delete: { _index: indexName(), _id: id } })),
      });
      return true;
    },
    false,
    { operation: 'removeFromIndex' },
  );
}

/** Rebuilds the index from PostgreSQL. Used by `npm run search:reindex`. */
export async function reindexAll(batchSize = 500): Promise<{ indexed: number }> {
  await ensureIndex();

  let cursor: string | undefined;
  let indexed = 0;

  for (;;) {
    const batch = await prisma.emailRecipient.findMany({
      select: rowSelect,
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;

    indexed += await indexRecipients(batch);
    cursor = batch[batch.length - 1]?.id;
    if (batch.length < batchSize) break;
  }

  await withSearch(
    async (client) => client.indices.refresh({ index: indexName() }),
    undefined,
    { operation: 'refresh' },
  );

  logger.info('Reindex complete', { indexed });
  return { indexed };
}
