/** Machine-readable error codes. Clients switch on these, not on messages. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  SENDER_NOT_FOUND: 'SENDER_NOT_FOUND',
  SENDER_NOT_VERIFIED: 'SENDER_NOT_VERIFIED',
  JOB_NOT_CANCELLABLE: 'JOB_NOT_CANCELLABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ApiSuccess<TData> {
  success: true;
  data: TData;
  message?: string;
  meta?: Pagination;
}

export interface ApiFailure {
  success: false;
  error: {
    code: ErrorCodeValue;
    message: string;
    /** Field-level messages for validation failures. */
    details?: Record<string, string[]>;
  };
}

export type ApiResponse<TData> = ApiSuccess<TData> | ApiFailure;
