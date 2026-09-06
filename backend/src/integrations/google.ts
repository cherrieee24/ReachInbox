import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { googleConfig } from '../config/env.js';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatar: string | null;
}

const SCOPES = ['openid', 'email', 'profile'];

function client(): OAuth2Client {
  const { clientId, clientSecret, callbackUrl } = googleConfig();
  return new OAuth2Client({ clientId, clientSecret, redirectUri: callbackUrl });
}

/** Opaque, unguessable value tying the callback back to the request that started it. */
export function createOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

export function buildAuthUrl(state: string): string {
  return client().generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'select_account',
    include_granted_scopes: true,
  });
}

/**
 * Exchanges the one-time code for tokens and verifies the returned ID token
 * against Google's public keys. The client secret is used here, server-side
 * only — it is never sent to the browser.
 */
export async function exchangeCodeForProfile(code: string): Promise<GoogleProfile> {
  const oauthClient = client();
  const { tokens } = await oauthClient.getToken(code);

  if (!tokens.id_token) {
    throw new Error('Google did not return an ID token');
  }

  const ticket = await oauthClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: googleConfig().clientId,
  });

  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error('Google ID token is missing the subject or email claim');
  }
  if (payload.email_verified === false) {
    throw new Error('Google account email is not verified');
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email.split('@')[0] ?? 'ReachInbox user',
    avatar: payload.picture ?? null,
  };
}
