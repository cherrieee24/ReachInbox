import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { logger } from '../utils/logger.js';
import { databaseUrl, isProduction } from './env.js';

/**
 * Prisma 7 takes its connection through a driver adapter rather than a URL in
 * schema.prisma. One client is shared process-wide; tsx's watch mode reloads
 * the module, so the instance is cached on globalThis to avoid pool churn.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl() });
  return new PrismaClient({
    adapter,
    log: isProduction ? ['error'] : ['warn', 'error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (!isProduction) globalForPrisma.prisma = prisma;

/** Fails fast at boot rather than on the first request. */
export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('Database connected');
}

/** Drains the pool so in-flight queries finish before the process exits. */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}

export interface DatabaseHealth {
  connected: boolean;
  latencyMs?: number;
  error?: string;
}

/** Cheap round trip for the health endpoint and readiness probes. */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { connected: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
}
