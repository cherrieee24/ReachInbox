/** The signed-in user, exactly as `GET /auth/me` returns it. */
export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Reasons the backend can redirect back to /login with `?error=`. */
export type AuthErrorCode =
  | 'access_denied'
  | 'invalid_state'
  | 'missing_code'
  | 'oauth_failed'
  | 'oauth_unavailable';

/** Slack workspace connection state for the signed-in user. */
export interface SlackStatus {
  connected: boolean;
  /** False when the server has no Slack credentials configured. */
  configured: boolean;
  teamId?: string;
  teamName?: string;
  channelName?: string | null;
  scope?: string | null;
  connectedAt?: string;
}
