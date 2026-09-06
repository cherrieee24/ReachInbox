import { SearchX, Send } from 'lucide-react';
import { useState } from 'react';
import { EmailListPanel } from '../components/email/EmailListPanel';
import type { StatusFilterOption } from '../components/email/EmailToolbar';
import { SentEmailsTable } from '../components/email/SentEmailsTable';
import { EmptyState } from '../components/ui/EmptyState';
import { useSentEmails } from '../hooks/useEmails';

const STATUS_OPTIONS: StatusFilterOption[] = [
  { label: 'All statuses', value: 'all' },
  { label: 'Sent', value: 'SENT' },
  { label: 'Failed', value: 'FAILED' },
];

export interface SentEmailsViewProps {
  title?: string;
  description?: string;
  pageSize?: number;
}

/** Reused by the dashboard tab and the standalone /sent route. */
export function SentEmailsView({
  title = 'Sent Emails',
  description = 'Every delivery attempt, newest first.',
  pageSize = 10,
}: SentEmailsViewProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');

  const emails = useSentEmails({
    page,
    pageSize,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(status !== 'all' ? { status } : {}),
  });

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
      itemLabel="sent emails"
      loadingLabel="Loading sent emails"
      emptyState={
        <EmptyState
          icon={Send}
          title="Nothing has been sent yet."
          description="Once your scheduled campaigns start delivering, every send shows up here."
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
      {(items) => <SentEmailsTable emails={items} />}
    </EmailListPanel>
  );
}

export default function SentEmailsPage() {
  return <SentEmailsView />;
}
