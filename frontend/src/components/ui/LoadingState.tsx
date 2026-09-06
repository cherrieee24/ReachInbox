import { cn } from '../../utils/cn';
import { Skeleton } from './Skeleton';

export interface LoadingStateProps {
  /** Number of skeleton rows to render. */
  rows?: number;
  className?: string;
  label?: string;
}

/** Table-shaped loading placeholder used while a list is being fetched. */
export function LoadingState({ rows = 6, className, label = 'Loading data' }: LoadingStateProps) {
  return (
    <div className={cn('divide-y divide-slate-200', className)} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-4">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="hidden h-3 w-28 sm:block" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}
