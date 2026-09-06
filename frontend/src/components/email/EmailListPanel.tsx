import type { ReactNode } from 'react';
import type { Pagination as PaginationMeta } from '../../types/api';
import { apiErrorMessage } from '../../utils/apiErrorMessage';
import { Card, CardHeader } from '../ui/Card';
import { ErrorState } from '../ui/ErrorState';
import { LoadingState } from '../ui/LoadingState';
import { Pagination } from '../ui/Pagination';
import { EmailToolbar, type StatusFilterOption } from './EmailToolbar';

export interface EmailListPanelProps<TItem> {
  title: string;
  description: string;
  items: TItem[];
  meta?: PaginationMeta;
  isLoading: boolean;
  isFetching?: boolean;
  isError: boolean;
  error?: unknown;
  onRetry: () => void;

  query: string;
  onQueryChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  statusOptions: StatusFilterOption[];
  page: number;
  onPageChange: (page: number) => void;

  emptyState: ReactNode;
  /** Shown when filters exclude everything but data does exist. */
  noResultsState?: ReactNode;
  itemLabel: string;
  loadingLabel: string;
  actions?: ReactNode;
  children: (items: TItem[]) => ReactNode;
}

/**
 * Shared shell for the scheduled, sent and search views: toolbar, the
 * loading / error / empty states, and pagination driven by the API's own
 * `meta`. Each screen supplies only its columns.
 */
export function EmailListPanel<TItem>({
  title,
  description,
  items,
  meta,
  isLoading,
  isFetching = false,
  isError,
  error,
  onRetry,
  query,
  onQueryChange,
  status,
  onStatusChange,
  statusOptions,
  page,
  onPageChange,
  emptyState,
  noResultsState,
  itemLabel,
  loadingLabel,
  actions,
  children,
}: EmailListPanelProps<TItem>) {
  const isFiltered = query.trim().length > 0 || status !== 'all';

  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} description={description} actions={actions} />

      <EmailToolbar
        query={query}
        onQueryChange={onQueryChange}
        status={status}
        onStatusChange={onStatusChange}
        statusOptions={statusOptions}
        isBusy={isFetching && !isLoading}
      />

      {isLoading ? (
        <LoadingState rows={6} label={loadingLabel} />
      ) : isError ? (
        <ErrorState
          title="Could not load your emails"
          description={apiErrorMessage(error)}
          onRetry={onRetry}
        />
      ) : items.length === 0 ? (
        isFiltered ? (noResultsState ?? emptyState) : emptyState
      ) : (
        <>
          {children(items)}
          {meta ? (
            <Pagination
              page={page}
              pageSize={meta.pageSize}
              totalItems={meta.totalItems}
              onPageChange={onPageChange}
              itemLabel={itemLabel}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}
