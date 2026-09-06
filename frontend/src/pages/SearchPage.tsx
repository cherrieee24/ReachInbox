import { Search, SearchX } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { StatusFilterOption } from '../components/email/EmailToolbar';
import { EmailListPanel } from '../components/email/EmailListPanel';
import { RecipientCell } from '../components/email/RecipientCell';
import { StatusBadge } from '../components/email/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '../components/ui/Table';
import { useEmailSearch } from '../hooks/useEmails';
import type { EmailSearchHit } from '../types/email';
import { formatDateTime } from '../utils/format';

const STATUS_OPTIONS: StatusFilterOption[] = [
  { label: 'All statuses', value: 'all' },
  { label: 'Scheduled', value: 'SCHEDULED' },
  { label: 'Processing', value: 'PROCESSING' },
  { label: 'Sent', value: 'SENT' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

function ResultsTable({ hits }: { hits: EmailSearchHit[] }) {
  return (
    <>
      <div className="hidden md:block">
        <TableContainer>
          <Table>
            <caption className="sr-only">Search results</caption>
            <THead>
              <TR className="hover:bg-slate-50">
                <TH className="w-[30%]">Email</TH>
                <TH className="w-[36%]">Subject</TH>
                <TH className="w-[22%]">Time</TH>
                <TH className="w-[12%]">Status</TH>
              </TR>
            </THead>
            <TBody>
              {hits.map((hit) => (
                <TR key={hit.recipientId}>
                  <TD>
                    <RecipientCell email={hit.email} />
                  </TD>
                  <TD className="max-w-0">
                    <p className="truncate text-slate-900">{hit.subject}</p>
                  </TD>
                  <TD className="whitespace-nowrap text-slate-900">
                    {formatDateTime(hit.sentAt ?? hit.scheduledAt)}
                  </TD>
                  <TD>
                    <StatusBadge status={hit.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      </div>

      <ul className="divide-y divide-slate-200 md:hidden">
        {hits.map((hit) => (
          <li key={hit.recipientId} className="space-y-2 px-4 py-4">
            <RecipientCell email={hit.email} />
            <p className="truncate text-sm text-slate-700">{hit.subject}</p>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={hit.status} />
              <span className="text-xs text-slate-500">
                {formatDateTime(hit.sentAt ?? hit.scheduledAt)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Full-text search across scheduled and sent email, backed by Elasticsearch.
 * The query lives in the URL so a search can be linked to and reloaded.
 */
export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');

  const q = params.get('q') ?? '';
  const enabled = q.trim().length > 0;

  const results = useEmailSearch(
    {
      q: q.trim(),
      page,
      pageSize: 10,
      ...(status !== 'all' ? { status } : {}),
    },
    enabled,
  );

  return (
    <EmailListPanel
      title="Search"
      description="Search every scheduled and sent email by recipient or subject."
      items={enabled ? (results.data?.data ?? []) : []}
      meta={enabled ? results.data?.meta : undefined}
      isLoading={enabled && results.isPending}
      isFetching={results.isFetching}
      isError={results.isError}
      error={results.error}
      onRetry={() => void results.refetch()}
      query={q}
      onQueryChange={(value) => {
        const next = new URLSearchParams(params);
        if (value.trim()) next.set('q', value);
        else next.delete('q');
        setParams(next, { replace: true });
        setPage(1);
      }}
      status={status}
      onStatusChange={(value) => {
        setStatus(value);
        setPage(1);
      }}
      statusOptions={STATUS_OPTIONS}
      page={page}
      onPageChange={setPage}
      itemLabel="results"
      loadingLabel="Searching"
      emptyState={
        enabled ? (
          <EmptyState
            icon={SearchX}
            title="No matches"
            description={`Nothing matched “${q}”. Try a different address, domain or subject.`}
          />
        ) : (
          <EmptyState
            icon={Search}
            title="Search your email"
            description="Start typing above to search by recipient address, domain or subject line."
          />
        )
      }
      noResultsState={
        <EmptyState
          icon={SearchX}
          title="No matches"
          description="Nothing matched that search with the current status filter."
        />
      }
    >
      {(hits) => <ResultsTable hits={hits} />}
    </EmailListPanel>
  );
}
