import { CalendarClock, SearchX, Send } from 'lucide-react';
import { useState } from 'react';
import { EmailListPanel } from '../components/email/EmailListPanel';
import type { StatusFilterOption } from '../components/email/EmailToolbar';
import { ScheduledEmailsTable } from '../components/email/ScheduledEmailsTable';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { useCompose } from '../context/ComposeContext';
import { useToast } from '../context/ToastContext';
import { useCancelEmailJob, useScheduledEmails } from '../hooks/useEmails';
import { apiErrorMessage } from '../utils/apiErrorMessage';

const STATUS_OPTIONS: StatusFilterOption[] = [
  { label: 'All statuses', value: 'all' },
  { label: 'Scheduled', value: 'SCHEDULED' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Processing', value: 'PROCESSING' },
];

export interface ScheduledEmailsViewProps {
  title?: string;
  description?: string;
  pageSize?: number;
}

/** Reused by the dashboard tab and the standalone /scheduled route. */
export function ScheduledEmailsView({
  title = 'Scheduled Emails',
  description = 'Emails waiting in the queue, ordered by delivery time.',
  pageSize = 10,
}: ScheduledEmailsViewProps) {
  const compose = useCompose();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');

  const query = {
    page,
    pageSize,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(status !== 'all' ? { status } : {}),
  };

  const emails = useScheduledEmails(query);

  const cancel = useCancelEmailJob({
    onSuccess: () => toast.success('Campaign cancelled', 'Pending emails will not be sent.'),
    onError: (error) => toast.error('Could not cancel campaign', apiErrorMessage(error)),
  });

  // Filters live in state, so reset to page 1 whenever they change.
  const updateFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <EmailListPanel
      title={title}
      description={description}
      items={emails.data?.data ?? []}
      meta={emails.data?.meta}
      isLoading={emails.isPending}
      isFetching={emails.isFetching}
      isError={emails.isError}
      error={emails.error}
      onRetry={() => void emails.refetch()}
      query={search}
      onQueryChange={(value) => updateFilter(() => setSearch(value))}
      status={status}
      onStatusChange={(value) => updateFilter(() => setStatus(value))}
      statusOptions={STATUS_OPTIONS}
      page={page}
      onPageChange={setPage}
      itemLabel="scheduled emails"
      loadingLabel="Loading scheduled emails"
      emptyState={
        <EmptyState
          icon={CalendarClock}
          title="No scheduled emails yet."
          description="Create your first email campaign to get started."
          action={
            <Button onClick={compose.open} leftIcon={<Send className="h-4 w-4" aria-hidden="true" />}>
              Compose New Email
            </Button>
          }
        />
      }
      noResultsState={
        <EmptyState
          icon={SearchX}
          title="No matching emails"
          description="Nothing here matches your search and filters. Try widening them."
        />
      }
    >
      {(items) => (
        <ScheduledEmailsTable
          emails={items}
          isCancelling={cancel.isPending}
          onCancelCampaign={(emailJobId) => cancel.mutate(emailJobId)}
        />
      )}
    </EmailListPanel>
  );
}

export default function ScheduledEmailsPage() {
  return <ScheduledEmailsView />;
}
