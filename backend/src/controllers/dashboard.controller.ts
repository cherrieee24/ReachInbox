import type { Request, Response } from 'express';
import { getDashboardStats } from '../services/dashboard.service.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/apiResponse.js';

export async function getStats(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  sendSuccess(res, await getDashboardStats(req.user.id));
}
