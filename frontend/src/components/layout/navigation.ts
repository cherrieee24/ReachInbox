import { CalendarClock, LayoutDashboard, Search, Send, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Application routes, referenced by name instead of inline strings. */
export const routes = {
  login: '/login',
  dashboard: '/dashboard',
  scheduled: '/scheduled',
  sent: '/sent',
  compose: '/compose',
  search: '/search',
  settings: '/settings',
} as const;

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const primaryNav: NavItem[] = [
  { to: routes.dashboard, label: 'Dashboard', icon: LayoutDashboard },
  { to: routes.scheduled, label: 'Scheduled Emails', icon: CalendarClock },
  { to: routes.sent, label: 'Sent Emails', icon: Send },
  { to: routes.search, label: 'Search', icon: Search },
  { to: routes.settings, label: 'Settings', icon: Settings },
];

export interface PageMeta {
  title: string;
  breadcrumb?: string[];
}

export const pageTitles: Record<string, PageMeta> = {
  [routes.dashboard]: { title: 'Dashboard' },
  [routes.scheduled]: { title: 'Scheduled Emails', breadcrumb: ['Campaigns', 'Scheduled'] },
  [routes.sent]: { title: 'Sent Emails', breadcrumb: ['Campaigns', 'Sent'] },
  [routes.compose]: { title: 'Compose Email', breadcrumb: ['Campaigns', 'Compose'] },
  [routes.search]: { title: 'Search', breadcrumb: ['Campaigns', 'Search'] },
  [routes.settings]: { title: 'Settings' },
};
