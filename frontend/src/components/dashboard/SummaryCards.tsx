import { CalendarClock, CheckCircle2, Send, XCircle } from 'lucide-react';
import type { DashboardStats, QueueState } from '../../types/email';
import { formatNumber } from '../../utils/format';
import { SummaryCard } from './SummaryCard';

const queueLabels: Record<QueueState, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  paused: 'Paused',
};

export interface SummaryCardsProps {
  stats: DashboardStats | undefined;
  isLoading?: boolean;
}

export function SummaryCards({ stats, isLoading = false }: SummaryCardsProps) {
  const queueState = stats?.queue.state ?? 'healthy';

  // Only user-scoped numbers here: `queue.delayed` counts the whole queue
  // across every account, so showing it beside "your" figures would read as
  // though those were all yours.
  const queueCaption = stats
    ? `${formatNumber(stats.queue.active)} sending · ${formatNumber(stats.queue.waiting)} waiting`
    : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        label="Scheduled Emails"
        value={stats?.scheduled ?? 0}
        icon={CalendarClock}
        tone="brand"
        caption="Queued for future delivery"
        isLoading={isLoading}
      />
      <SummaryCard
        label="Sent Emails"
        value={stats?.sent ?? 0}
        icon={Send}
        tone="success"
        caption="Delivered successfully"
        isLoading={isLoading}
      />
      <SummaryCard
        label="Failed Emails"
        value={stats?.failed ?? 0}
        icon={XCircle}
        tone="danger"
        caption="Bounced or rejected"
        isLoading={isLoading}
      />
      <SummaryCard
        label="Queue Status"
        value={queueLabels[queueState]}
        icon={CheckCircle2}
        tone={queueState === 'healthy' ? 'success' : 'danger'}
        caption={queueCaption}
        isLoading={isLoading}
      />
    </div>
  );
}
