import { closeSearchClient } from '../src/config/elasticsearch.js';
import { reindexAll } from '../src/services/search.service.js';
import { logger } from '../src/utils/logger.js';

/**
 * Rebuilds the search index from PostgreSQL. Safe to run at any time — the
 * database is the source of truth, so this is always the way back from drift.
 */
async function main(): Promise<void> {
  const { indexed } = await reindexAll();
  logger.info('Reindex finished', { indexed });
}

main()
  .catch((error: unknown) => {
    logger.error('Reindex failed', error);
    process.exitCode = 1;
  })
  .finally(() => void closeSearchClient().then(() => process.exit()));
