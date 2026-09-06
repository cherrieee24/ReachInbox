import { Router } from 'express';
import { getStats } from '../controllers/dashboard.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/stats', asyncHandler(requireAuth), asyncHandler(getStats));

export default router;
