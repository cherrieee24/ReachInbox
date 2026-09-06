import { forwardRef, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';
import { Field, controlBase, controlTone, describedBy } from './Field';

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  aside?: ReactNode;
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { id, label, hint, error, aside, containerClassName, className, required, rows = 8, ...props },
  ref,
) {
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      aside={aside}
      className={containerClassName}
    >
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(controlBase, controlTone(Boolean(error)), 'resize-y px-3 py-2 leading-relaxed', className)}
        {...props}
      />
    </Field>
  );
});
