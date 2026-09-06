import { useState } from 'react';
import { cn } from '../../utils/cn';
import { initialsFrom } from '../../utils/format';

const sizes = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-11 w-11 text-sm',
} as const;

export interface AvatarProps {
  name: string;
  src?: string;
  size?: keyof typeof sizes;
  className?: string;
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  // Google profile images can expire or 403 — fall back to initials rather
  // than leaving a broken image in the header. Recording *which* src failed
  // means a new src is retried without needing an effect to reset a flag.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
        className={cn(
          'shrink-0 rounded-full bg-slate-100 object-cover ring-1 ring-slate-200',
          sizes[size],
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full bg-brand-100 font-semibold uppercase text-brand-700 ring-1 ring-brand-200',
        sizes[size],
        className,
      )}
    >
      {initialsFrom(name)}
    </span>
  );
}
