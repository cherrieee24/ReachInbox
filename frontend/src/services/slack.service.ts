import { endpoints, http } from '../api';
import { env } from '../config/env';
import type { SlackStatus } from '../types/user';

/**
 * Slack integration. The OAuth handshake happens between the browser, our
 * backend and Slack — the client secret and the workspace token never reach
 * the frontend.
 */
export const slackService = {
  /** Full-page navigation target that starts the install flow. */
  connectUrl(): string {
    return `${env.apiUrl}${endpoints.slack.connect}`;
  },

  async status(): Promise<SlackStatus> {
    const { data } = await http.get<SlackStatus>(endpoints.slack.status);
    return data;
  },

  async disconnect(): Promise<{ disconnected: number }> {
    const { data } = await http.post<{ disconnected: number }>(endpoints.slack.disconnect);
    return data;
  },
};
