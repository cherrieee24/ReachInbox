import { useMemo, useState } from 'react';

export interface UsePaginationResult<T> {
  page: number;
  pageSize: number;
  totalPages: number;
  items: T[];
  setPage: (page: number) => void;
}

/** Client-side slicing for list views. */
export function usePagination<T>(source: T[], pageSize = 8): UsePaginationResult<T> {
  const [requestedPage, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(source.length / pageSize));

  // Derived rather than corrected after the fact: when the list shrinks the
  // page number is clamped for this render, with no extra render pass.
  const page = Math.min(requestedPage, totalPages);

  const items = useMemo(
    () => source.slice((page - 1) * pageSize, page * pageSize),
    [source, page, pageSize],
  );

  return { page, pageSize, totalPages, items, setPage };
}
