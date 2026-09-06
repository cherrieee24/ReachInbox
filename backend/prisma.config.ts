import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 keeps the connection URL out of schema.prisma — migrations read it
 * from here, and the runtime client gets it through the pg driver adapter.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
