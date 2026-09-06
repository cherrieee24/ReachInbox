import { endpoints, http } from '../api';
import { env } from '../config/env';
import type { User } from '../types/user';

/**
 * The OAuth handshake happens entirely between the browser, our backend and
 * Google. The Google client secret lives only on the server; the browser never
 * sees a token — the session arrives as an httpOnly cookie.
 */
export const authService = {
  /** Full-page navigation target that starts the Google flow. */
  googleLoginUrl(): string {
    return `${env.apiUrl}${endpoints.auth.google}`;
  },

  async currentUser(): Promise<User> {
    const { data } = await http.get<User>(endpoints.auth.me);
    return data;
  },

  async logout(): Promise<void> {
    await http.post<null>(endpoints.auth.logout);
  },
};
