import { Router } from 'express';
import {
  getCurrentUser,
  handleGoogleCallback,
  logout,
  startGoogleAuth,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { sensitiveLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Sign-in is unauthenticated and hits Google on every call, so it gets a
// tighter budget than the rest of the API.
const authLimiter = sensitiveLimiter(20, 'RATE_LIMIT_AUTH_PER_MINUTE');

router.get('/google', authLimiter, startGoogleAuth);
router.get('/google/callback', authLimiter, asyncHandler(handleGoogleCallback));
router.get('/me', asyncHandler(requireAuth), getCurrentUser);
router.post('/logout', logout);

export default router;
