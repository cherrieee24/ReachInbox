import { ApiError } from '../api';

/**
 * Turns any thrown value into something worth showing a person.
 *
 * The backend already sends a readable `error.message`, so that is preferred;
 * these are the fallbacks for when it does not, mapped by HTTP status.
 */
const BY_STATUS: Record<number, string> = {
  400: 'Some of the values you entered are not valid.',
  401: 'Your session has expired. Sign in again to continue.',
  403: 'You do not have permission to do that.',
  404: 'We could not find what you were looking for.',
  409: 'That conflicts with something that already exists.',
  413: 'That file is too large to upload.',
  429: 'Too many requests. Wait a moment and try again.',
  500: 'Something went wrong on our side. Try again shortly.',
};

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.message) return error.message;
    if (error.status && BY_STATUS[error.status]) return BY_STATUS[error.status];
    return 'Something went wrong. Try again.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

/** Field-level messages from a 400, keyed by form field name. */
export function apiFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.fields) return {};
  return Object.fromEntries(
    Object.entries(error.fields).map(([field, messages]) => [
      // "recipients.0" → "recipients": the form shows one message per field.
      field.split('.')[0] ?? field,
      messages[0] ?? 'Invalid value',
    ]),
  );
}
