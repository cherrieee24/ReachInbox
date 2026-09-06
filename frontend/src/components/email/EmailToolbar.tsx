import { Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Spinner } from '../ui/Spinner';

export interface StatusFilterOption {
  label: string;
  value: string;
}

export interface EmailToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  statusOptions: StatusFilterOption[];
  searchPlaceholder?: string;
  isBusy?: boolean;
}

/**
 * Search + status filter. The input is debounced so typing does not fire a
 * request per keystroke, while staying fully controlled by the parent.
 */
export function EmailToolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  statusOptions,
  searchPlaceholder = 'Search by recipient or subject',
  isBusy = false,
}: EmailToolbarProps) {
  const searchId = useId();
  const statusId = useId();
  const [draft, setDraft] = useState(query);
  const [lastQuery, setLastQuery] = useState(query);

  // Re-sync when the parent resets the query (e.g. clearing filters).
  // Adjusting during render rather than in an effect avoids the extra render
  // pass, and React re-runs this component immediately without committing.
  if (query !== lastQuery) {
    setLastQuery(query);
    setDraft(query);
  }

  useEffect(() => {
    if (draft === query) return;
    const timer = window.setTimeout(() => onQueryChange(draft), 300);
    return () => window.clearTimeout(timer);
  }, [draft, query, onQueryChange]);

  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <label htmlFor={searchId} className="sr-only">
          Search emails
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
        <input
          id={searchId}
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 text-sm text-slate-900 shadow-sm transition-colors hover:border-slate-400 focus-visible:border-brand-500"
        />
        {isBusy ? (
          <Spinner
            size="sm"
            label="Updating results"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
        ) : null}
      </div>

      <div className="sm:w-44">
        <label htmlFor={statusId} className="sr-only">
          Filter by status
        </label>
        <select
          id={statusId}
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
          className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors hover:border-slate-400 focus-visible:border-brand-500"
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
