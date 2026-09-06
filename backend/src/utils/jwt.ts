import jwt from 'jsonwebtoken';
import { authConfig } from '../config/env.js';

export interface SessionClaims {
  /** User id (Prisma cuid). */
  sub: string;
  email: string;
}

/** Signs a short-lived session token. The secret never leaves the server. */
export function signSessionToken(claims: SessionClaims): string {
  const { jwtSecret, sessionTtlSeconds } = authConfig();
  return jwt.sign(claims, jwtSecret, {
    expiresIn: sessionTtlSeconds,
    issuer: 'reachinbox',
    audience: 'reachinbox-web',
  });
}

/** Returns the claims, or null when the token is missing, altered or expired. */
export function verifySessionToken(token: string): SessionClaims | null {
  try {
    const { jwtSecret } = authConfig();
    const payload = jwt.verify(token, jwtSecret, {
      issuer: 'reachinbox',
      audience: 'reachinbox-web',
    });

    if (typeof payload === 'string' || !payload.sub || typeof payload.sub !== 'string') {
      return null;
    }
    const email = typeof payload.email === 'string' ? payload.email : '';
    return { sub: payload.sub, email };
  } catch {
    return null;
  }
}
