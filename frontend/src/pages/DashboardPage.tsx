import { CalendarClock, Plus, Send } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlackCard } from '../components/dashboard/SlackCard';
import { SummaryCards } from '../components/dashboard/SummaryCards';
import { Button } from '../components/ui/Button';
import { ErrorState } from '../components/ui/ErrorState';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { useAuth } from '../context/AuthContext';
import { useCompose } from '../context/ComposeContext';
import { useDashboardStats } from '../hooks/useDashboardStats';
import { apiErrorMessage } from '../utils/apiErrorMessage';
import { ScheduledEmailsView } from './ScheduledEmailsPage';
import { SentEmailsView } from './SentEmailsPage';

export default function DashboardPage() {
  const [tab, setTab] = useState('scheduled');
  const [params] = useSearchParams();
  const compose = useCompose();
  const { user } = useAuth();
  const stats = useDashboardStats();

  const firstName = user?.name.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Welcome back, {firstName}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Here is how your outbound email is performing right now.
          </p>
        </div>
        <Button onClick={compose.open} leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}>
          Compose New Email
        </Button>
      </section>

      <section aria-label="Summary">
        {stats.isError ? (
          <div className="rounded-xl border border-slate-200 bg-white shadow-card">
            <ErrorState
              title="Could not load your statistics"
              description={apiErrorMessage(stats.error)}
              onRetry={() => void stats.refetch()}
            />
          </div>
        ) : (
          <SummaryCards stats={stats.data} isLoading={stats.isPending} />
        )}
      </section>

      <section aria-label="Integrations">
        <SlackCard outcome={params.get('slack')} />
      </section>

      <section aria-label="Email activity" className="space-y-4">
        <Tabs
          aria-label="Email activity"
          value={tab}
          onChange={setTab}
          items={[
            {
              id: 'scheduled',
              label: 'Scheduled Emails',
              count: stats.data?.scheduled,
              icon: <CalendarClock className="h-4 w-4" aria-hidden="true" />,
            },
            {
              id: 'sent',
              label: 'Sent Emails',
              count: stats.data?.sent,
              icon: <Send className="h-4 w-4" aria-hidden="true" />,
            },
          ]}
        />

        <TabPanel>
          {tab === 'scheduled' ? (
            <ScheduledEmailsView
              title="Upcoming sends"
              description="The next emails your queue will deliver."
              pageSize={5}
            />
          ) : (
            <SentEmailsView
              title="Recent deliveries"
              description="The most recent delivery attempts across all campaigns."
              pageSize={5}
            />
          )}
        </TabPanel>
      </section>
    </div>
  );
}
