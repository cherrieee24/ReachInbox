import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface FieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
  /** Rendered on the right of the label row — e.g. a character counter. */
  aside?: ReactNode;
}

/**
 * Shared label / hint / error scaffolding for form controls. Controls wire
 * themselves up with `aria-describedby={describedBy(id, hint, error)}`.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
  aside,
}: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
          {required ? (
            <span className="ml-0.5 text-red-600" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
        {aside ? <span className="text-xs text-slate-400">{aside}</span> : null}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, hint?: ReactNode, error?: string): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export const controlBase =
  'w-full rounded-lg border bg-white text-sm text-slate-900 shadow-sm transition-colors ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

export const controlTone = (hasError?: boolean) =>
  hasError
    ? 'border-red-300 focus-visible:ring-red-500'
    : 'border-slate-300 hover:border-slate-400 focus-visible:border-brand-500';
