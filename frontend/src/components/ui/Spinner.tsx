import { cn } from '../../utils/cn';

const sizes = {
  sm: 'h-4 w-4 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-8 w-8 border-[3px]',
} as const;

export interface SpinnerProps {
  size?: keyof typeof sizes;
  className?: string;
  label?: string;
  /**
   * Set when an ancestor already announces the loading state. Two nested
   * live regions make a screen reader read the same thing twice.
   */
  decorative?: boolean;
}

export function Spinner({
  size = 'md',
  className,
  label = 'Loading',
  decorative = false,
}: SpinnerProps) {
  return (
    <span
      {...(decorative ? { 'aria-hidden': true } : { role: 'status', 'aria-label': label })}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-r-transparent align-[-0.125em]',
        sizes[size],
        className,
      )}
    />
  );
}
