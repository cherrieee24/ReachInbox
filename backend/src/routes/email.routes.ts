import { Router } from 'express';
import * as controller from '../controllers/email.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import {
  idParamSchema,
  listQuerySchema,
  scheduleEmailSchema,
  searchQuerySchema,
  validateFileSchema,
} from '../types/email.schema.js';
import { sensitiveLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// These two do real work per request — parsing up to 5 MB of recipients, and
// writing thousands of rows plus queue jobs — so they are budgeted separately.
const heavyLimiter = sensitiveLimiter(30, 'RATE_LIMIT_HEAVY_PER_MINUTE');

// Every email route is authenticated; ownership is enforced in the service.
router.use(asyncHandler(requireAuth));

router.get('/search', validate(searchQuerySchema, 'query'), asyncHandler(controller.search));
router.get('/scheduled', validate(listQuerySchema, 'query'), asyncHandler(controller.getScheduled));
router.get('/sent', validate(listQuerySchema, 'query'), asyncHandler(controller.getSent));
router.post('/schedule', heavyLimiter, validate(scheduleEmailSchema), asyncHandler(controller.schedule));
router.post('/validate-file', heavyLimiter, validate(validateFileSchema), controller.validateFile);

// Declared after the literal paths so "/scheduled" is never read as an id.
router.get('/:id', validate(idParamSchema, 'params'), asyncHandler(controller.getById));
router.delete('/:id', validate(idParamSchema, 'params'), asyncHandler(controller.cancel));

export default router;
