import { AlertTriangle, Bell, CalendarClock, CheckCircle2, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import type { DashboardStats } from '../../types/email';
import { formatDateTime, formatNumber, formatRelative } from '../../utils/format';
import { Dropdown } from '../ui/Dropdown';
import { routes } from './navigation';

interface Alert {
  id: string;
  icon: typeof Bell;
  iconClass: string;
  title: string;
  detail: string;
  to: string;
  /** Needs attention, as opposed to being purely informational. */
  urgent: boolean;
}

/**
 * Alerts are derived from live dashboard statistics rather than a separate
 * notifications feed — there is no such endpoint, and inventing one would mean
 * showing the user things that never happened.
 */
function buildAlerts(stats: DashboardStats | undefined): Alert[] {
  if (!stats) return [];
  const alerts: Alert[] = [];

  if (stats.failed > 0) {
    alerts.push({
      id: 'failed',
      icon: XCircle,
      iconClass: 'text-red-600 bg-red-50',
      title: `${formatNumber(stats.failed)} email${stats.failed === 1 ? '' : 's'} failed to send`,
      detail: 'Open Sent Emails to see the delivery errors.',
      to: routes.sent,
      urgent: true,
    });
  }

  if (stats.queue.state !== 'healthy') {
    alerts.push({
      id: 'queue',
      icon: AlertTriangle,
      iconClass: 'text-amber-600 bg-amber-50',
      title: `Queue is ${stats.queue.state}`,
      detail: `${formatNumber(stats.queue.waiting)} email(s) waiting, ${formatNumber(stats.queue.active)} in flight.`,
      to: routes.scheduled,
      urgent: true,
    });
  }

  if (stats.nextSendAt) {
    alerts.push({
      id: 'next',
      icon: CalendarClock,
      iconClass: 'text-brand-600 bg-brand-50',
      title: `Next send ${formatRelative(stats.nextSendAt)}`,
      detail: formatDateTime(stats.nextSendAt),
      to: routes.scheduled,
      urgent: false,
    });
  }

  if (alerts.length === 0 && stats.sent > 0) {
    alerts.push({
      id: 'ok',
      icon: CheckCircle2,
      iconClass: 'text-emerald-600 bg-emerald-50',
      title: 'Everything is running smoothly',
      detail: `${formatNumber(stats.sent)} email(s) delivered, nothing failing.`,
      to: routes.sent,
      urgent: false,
    });
  }

  return alerts;
}

export function NotificationMenu() {
  const stats = useDashboardStats();
  const alerts = buildAlerts(stats.data);
  const urgentCount = alerts.filter((alert) => alert.urgent).length;

  return (
    <Dropdown
      label={`Notifications, ${urgentCount} needing attention`}
      menuClassName="w-[21rem] max-w-[calc(100vw-2rem)] p-0"
      trigger={() => (
        <span className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700">
          <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
          {urgentCount > 0 ? (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
          ) : null}
        </span>
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Notifications</h3>
        {urgentCount > 0 ? (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
            {urgentCount} to review
          </span>
        ) : null}
      </div>

      {alerts.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">
          {stats.isPending ? 'Loading…' : 'Nothing to report yet.'}
        </p>
      ) : (
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {alerts.map((alert) => (
            <li key={alert.id}>
              <Link to={alert.to} className="flex gap-3 px-4 py-3 transition-colors hover:bg-slate-50">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${alert.iconClass}`}
                >
                  <alert.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{alert.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{alert.detail}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Dropdown>
  );
}
