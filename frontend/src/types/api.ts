/** Cursor-free, page-based metadata returned alongside list endpoints. */
export interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/** Envelope every backend endpoint is expected to return. */
export interface ApiResponse<TData> {
  success: boolean;
  data: TData;
  message?: string;
  meta?: Pagination;
}

export interface PaginatedResponse<TItem> extends ApiResponse<TItem[]> {
  meta: Pagination;
}

/** Error envelope returned by the backend: { success: false, error: {...} }. */
export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    /** Field-level validation messages, keyed by field path. */
    details?: Record<string, string[]>;
  };
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}
