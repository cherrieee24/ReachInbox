import { ErrorCode, type ErrorCodeValue } from '../types/api.js';

/**
 * An error the client is allowed to see. Anything thrown that is not an
 * AppError is treated as a bug and reported as a generic 500.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCodeValue;
  readonly details: Record<string, string[]> | undefined;

  constructor(
    status: number,
    code: ErrorCodeValue,
    message: string,
    details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: Record<string, string[]>): AppError {
    return new AppError(400, ErrorCode.VALIDATION_ERROR, message, details);
  }

  static unauthorized(message = 'Not authenticated'): AppError {
    return new AppError(401, ErrorCode.UNAUTHORIZED, message);
  }

  static forbidden(message = 'You do not have access to this resource'): AppError {
    return new AppError(403, ErrorCode.FORBIDDEN, message);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(404, ErrorCode.NOT_FOUND, message);
  }

  static conflict(code: ErrorCodeValue, message: string): AppError {
    return new AppError(409, code, message);
  }

  static of(status: number, code: ErrorCodeValue, message: string): AppError {
    return new AppError(status, code, message);
  }
}
