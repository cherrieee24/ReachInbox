import type { PublicUser } from './auth.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth once the session cookie has been verified. */
      user?: PublicUser;
      /** Set by validate(schema, 'query'). */
      validatedQuery?: unknown;
      /** Set by validate(schema, 'params'). */
      validatedParams?: unknown;
    }
  }
}

export {};
