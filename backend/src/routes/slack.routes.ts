import { Router } from 'express';
import * as controller from '../controllers/slack.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { sensitiveLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

const oauthLimiter = sensitiveLimiter(20, 'RATE_LIMIT_AUTH_PER_MINUTE');

// The install flow is a top-level browser redirect, so the session cookie
// rides along and the route can still be authenticated.
router.get('/connect', oauthLimiter, asyncHandler(requireAuth), controller.connect);

// Slack calls this directly; it authenticates via the signed state cookie
// rather than requireAuth, because it is a fresh cross-site navigation.
router.get('/callback', oauthLimiter, asyncHandler(controller.callback));

router.get('/status', asyncHandler(requireAuth), asyncHandler(controller.status));
router.post('/disconnect', asyncHandler(requireAuth), asyncHandler(controller.disconnect));

export default router;
