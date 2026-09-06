import type { Response } from 'express';
import type { ApiFailure, ApiSuccess, ErrorCodeValue, Pagination } from '../types/api.js';

/** Every successful response in the API is shaped here. */
export function sendSuccess<TData>(
  res: Response,
  data: TData,
  options: { status?: number; message?: string; meta?: Pagination } = {},
): void {
  const body: ApiSuccess<TData> = { success: true, data };
  if (options.message) body.message = options.message;
  if (options.meta) body.meta = options.meta;
  res.status(options.status ?? 200).json(body);
}

export function sendError(
  res: Response,
  status: number,
  code: ErrorCodeValue,
  message: string,
  details?: Record<string, string[]>,
): void {
  const body: ApiFailure = { success: false, error: { code, message } };
  if (details) body.error.details = details;
  res.status(status).json(body);
}

export function buildPagination(page: number, pageSize: number, totalItems: number): Pagination {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}
