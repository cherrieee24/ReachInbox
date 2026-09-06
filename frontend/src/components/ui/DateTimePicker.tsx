import { CalendarClock } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { Field, controlBase, controlTone, describedBy } from './Field';

export interface DateTimePickerProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  containerClassName?: string;
}

/**
 * Wraps the native datetime-local control so we inherit the platform picker,
 * keyboard behaviour and locale formatting for free.
 */
export const DateTimePicker = forwardRef<HTMLInputElement, DateTimePickerProps>(
  function DateTimePicker(
    { id, label, hint, error, containerClassName, className, required, ...props },
    ref,
  ) {
    return (
      <Field id={id} label={label} hint={hint} error={error} required={required} className={containerClassName}>
        <div className="relative">
          <CalendarClock
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            ref={ref}
            id={id}
            type="datetime-local"
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(id, hint, error)}
            className={cn(controlBase, controlTone(Boolean(error)), 'h-10 pl-9 pr-3', className)}
            {...props}
          />
        </div>
      </Field>
    );
  },
);
