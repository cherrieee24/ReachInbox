import { Router } from 'express';
import { getCurrentUser } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import authRoutes from './auth.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import emailRoutes from './email.routes.js';
import healthRoutes from './health.routes.js';
import slackRoutes from './slack.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.get('/me', asyncHandler(requireAuth), getCurrentUser);
router.use('/emails', emailRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/slack', slackRoutes);

export default router;
