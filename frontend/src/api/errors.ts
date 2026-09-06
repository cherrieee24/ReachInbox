import { AxiosError } from 'axios';
import type { ApiErrorBody } from '../types/api';

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'rate_limited'
  | 'server'
  | 'unknown';

/** Normalised error every service and UI layer can rely on. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly fields: Record<string, string[]> | undefined;

  constructor(options: {
    message: string;
    kind: ApiErrorKind;
    status?: number;
    code?: string;
    fields?: Record<string, string[]>;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
    this.fields = options.fields;
  }

  get isAuthError(): boolean {
    return this.kind === 'unauthorized' || this.kind === 'forbidden';
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 422 || status === 400) return 'validation';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'unknown';
}

const DEFAULT_MESSAGES: Record<ApiErrorKind, string> = {
  network: 'Could not reach the server. Check your connection and try again.',
  timeout: 'The request took too long. Try again in a moment.',
  unauthorized: 'Your session has expired. Sign in again to continue.',
  forbidden: 'You do not have access to this resource.',
  not_found: 'We could not find what you were looking for.',
  validation: 'Some of the submitted values are invalid.',
  rate_limited: 'Too many requests. Slow down and try again shortly.',
  server: 'Something went wrong on our side. Try again shortly.',
  unknown: 'Something went wrong. Try again.',
};

/** Turns anything axios throws into an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof AxiosError) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ApiError({ message: DEFAULT_MESSAGES.timeout, kind: 'timeout', code: error.code });
    }

    const response = error.response;
    if (!response) {
      return new ApiError({ message: DEFAULT_MESSAGES.network, kind: 'network', code: error.code });
    }

    const body = response.data as Partial<ApiErrorBody> | undefined;
    const kind = kindForStatus(response.status);
    const envelope = body?.error;

    return new ApiError({
      message: envelope?.message ?? DEFAULT_MESSAGES[kind],
      kind,
      status: response.status,
      code: envelope?.code ?? error.code,
      fields: envelope?.details,
    });
  }

  return new ApiError({
    message: error instanceof Error ? error.message : DEFAULT_MESSAGES.unknown,
    kind: 'unknown',
  });
}
