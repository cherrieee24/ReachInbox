import type { LucideIcon } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatNumber } from '../../utils/format';
import { Skeleton } from '../ui/Skeleton';

const tones = {
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-emerald-50 text-emerald-600',
  danger: 'bg-red-50 text-red-600',
  neutral: 'bg-slate-100 text-slate-600',
} as const;

export interface SummaryCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: keyof typeof tones;
  caption?: string;
  isLoading?: boolean;
}

export function SummaryCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  caption,
  isLoading = false,
}: SummaryCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          {isLoading ? (
            <Skeleton className="mt-2 h-8 w-20" />
          ) : (
            <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {typeof value === 'number' ? formatNumber(value) : value}
            </p>
          )}
        </div>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tones[tone])}>
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
      </div>
      {isLoading ? (
        <Skeleton className="mt-3 h-3 w-28" />
      ) : caption ? (
        <p className="mt-2 text-xs text-slate-500">{caption}</p>
      ) : null}
    </div>
  );
}
