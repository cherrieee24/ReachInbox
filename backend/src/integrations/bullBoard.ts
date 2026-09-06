import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { Router } from 'express';
import { getEmailQueue } from '../queues/email.queue.js';
import { logger } from '../utils/logger.js';

export const BULL_BOARD_PATH = '/admin/queues';

/**
 * Bull Board, wired to the same Queue instance the API and worker use — so it
 * reads live Redis state rather than any separate bookkeeping. It is a viewer
 * over the real queue, not a reimplementation of one.
 *
 * The UI only ever receives job counts and job data. Job payloads hold ids
 * (`emailRecipientId`, `emailJobId`, `userId`, `senderId`) and nothing else,
 * so no message content reaches this page. The Redis connection string stays
 * server-side; Bull Board never surfaces it.
 */
export function createQueueDashboard(): Router {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);

  createBullBoard({
    queues: [new BullMQAdapter(getEmailQueue())],
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: 'ReachInbox Queues',
      },
    },
  });

  logger.info('Queue dashboard mounted', { path: BULL_BOARD_PATH });

  // Bull Board types getRouter() loosely; it is an Express Router.
  const router = serverAdapter.getRouter() as Router;
  return router;
}
