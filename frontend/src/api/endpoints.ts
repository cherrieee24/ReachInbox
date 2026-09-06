/**
 * Endpoint paths the backend is expected to expose. Kept in one place so the
 * service layer never inlines strings and route changes stay cheap.
 */
export const endpoints = {
  auth: {
    /** Full-page redirect that hands off to Google. */
    google: '/auth/google',
    me: '/auth/me',
    logout: '/auth/logout',
  },
  emails: {
    scheduled: '/emails/scheduled',
    sent: '/emails/sent',
    schedule: '/emails/schedule',
    validateFile: '/emails/validate-file',
    search: '/emails/search',
    byId: (id: string) => `/emails/${id}`,
    cancel: (id: string) => `/emails/${id}/cancel`,
  },
  dashboard: {
    stats: '/dashboard/stats',
  },
  slack: {
    /** Full-page redirect that hands off to Slack. */
    connect: '/slack/connect',
    status: '/slack/status',
    disconnect: '/slack/disconnect',
  },
} as const;
