import { CalendarClock, Info, Send } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useRecipientFile } from '../../hooks/useRecipientFile';
import type { ComposeFormValues, ScheduleRequest } from '../../types/email';
import type { ComposeSummaryData } from './ComposeSummary';
import { formatDateTime, formatNumber } from '../../utils/format';
import { Button } from '../ui/Button';
import { DateTimePicker } from '../ui/DateTimePicker';
import { FileUpload } from '../ui/FileUpload';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';

type Errors = Partial<Record<keyof ComposeFormValues | 'recipients', string>>;

const DELAY_OPTIONS = [
  { label: '10 seconds', value: '10' },
  { label: '30 seconds', value: '30' },
  { label: '1 minute', value: '60' },
  { label: '2 minutes', value: '120' },
  { label: '5 minutes', value: '300' },
];

const SUBJECT_MAX = 150;

function defaultStartTime(): string {
  const date = new Date(Date.now() + 15 * 60_000);
  date.setSeconds(0, 0);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface ComposeFormProps {
  /** Fires whenever the form changes, so a parent can render a live recap. */
  onChange?: (summary: ComposeSummaryData) => void;
  /** Receives the fully-assembled payload the scheduling API will accept. */
  onSubmit: (request: ScheduleRequest) => void;
  /** Field errors returned by the API on a 400, merged into the form. */
  serverErrors?: Partial<Record<string, string>>;
  onCancel?: () => void;
  isSubmitting?: boolean;
  /** Set by the parent when the actions belong to a surrounding footer. */
  formId?: string;
  hideActions?: boolean;
}

export function ComposeForm({
  onSubmit,
  onCancel,
  isSubmitting = false,
  formId,
  hideActions = false,
  serverErrors,
  onChange,
}: ComposeFormProps) {
  const fallbackId = useId();
  const id = formId ?? fallbackId;

  const [values, setValues] = useState<ComposeFormValues>({
    subject: '',
    body: '',
    startTime: defaultStartTime(),
    delayBetweenEmails: 30,
    hourlyLimit: 100,
  });
  const [errors, setErrors] = useState<Errors>({});
  const recipients = useRecipientFile();

  // The server has the final say, so its messages win over local ones.
  const fieldError = (field: keyof Errors): string | undefined =>
    (serverErrors?.[field] as string | undefined) ?? errors[field];

  function set<K extends keyof ComposeFormValues>(key: K, value: ComposeFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  const recipientCount = recipients.file?.schedulableCount ?? 0;

  /** Mirrors the server's own pacing maths, so the recap is not a guess. */
  const estimate = useMemo(() => {
    if (recipientCount < 1) return { durationLabel: null, completionAt: null };

    const perHour = Math.min(values.hourlyLimit, 3600 / Math.max(values.delayBetweenEmails, 1));
    const hours = (recipientCount - 1) / Math.max(perHour, 1);
    const startMs = new Date(values.startTime).getTime();

    return {
      durationLabel:
        hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : `${hours.toFixed(1)} hrs`,
      completionAt: Number.isNaN(startMs)
        ? null
        : new Date(startMs + hours * 3_600_000).toISOString(),
    };
  }, [recipientCount, values.delayBetweenEmails, values.hourlyLimit, values.startTime]);

  useEffect(() => {
    onChange?.({
      recipientCount,
      startTime: values.startTime,
      delayBetweenEmails: values.delayBetweenEmails,
      hourlyLimit: values.hourlyLimit,
      estimatedCompletionAt: estimate.completionAt,
    });
  }, [onChange, recipientCount, values.startTime, values.delayBetweenEmails, values.hourlyLimit, estimate.completionAt]);

  function validate(): Errors {
    const next: Errors = {};
    if (!values.subject.trim()) next.subject = 'Subject is required.';
    else if (values.subject.length > SUBJECT_MAX) next.subject = `Keep the subject under ${SUBJECT_MAX} characters.`;
    if (!values.body.trim()) next.body = 'Email body is required.';
    if (!recipients.file) next.recipients = 'Upload a recipient list to continue.';
    if (!values.startTime) next.startTime = 'Choose when the campaign should start.';
    else if (new Date(values.startTime).getTime() < Date.now() - 60_000)
      next.startTime = 'Start time must be in the future.';
    if (!Number.isFinite(values.hourlyLimit) || values.hourlyLimit < 1)
      next.hourlyLimit = 'Enter a limit of at least 1.';
    else if (values.hourlyLimit > 2000) next.hourlyLimit = 'Maximum is 2,000 emails per hour.';
    return next;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    onSubmit({
      ...values,
      // datetime-local has no timezone; the API expects ISO 8601 with offset.
      startTime: new Date(values.startTime).toISOString(),
      recipients: recipients.file?.validEmails ?? [],
    });
  }

  return (
    <form id={id} onSubmit={handleSubmit} noValidate className="space-y-6">
      <fieldset disabled={isSubmitting} className="space-y-6 disabled:opacity-60">
        <legend className="sr-only">Email content</legend>

        <Input
          id={`${id}-subject`}
          label="Subject"
          required
          placeholder="Quick question about your outbound stack"
          value={values.subject}
          onChange={(event) => set('subject', event.target.value)}
          error={fieldError('subject')}
          maxLength={SUBJECT_MAX + 20}
        />

        <Textarea
          id={`${id}-body`}
          label="Body"
          required
          rows={6}
          placeholder={'Hi there,\n\nI noticed your team is scaling outbound…'}
          value={values.body}
          onChange={(event) => set('body', event.target.value)}
          error={fieldError('body')}
          hint="Plain text. Personalisation variables land with the template engine."
          aside={`${formatNumber(values.body.length)} chars`}
        />

        <FileUpload
          label="Recipients"
          accept=".csv,.txt"
          file={recipients.file}
          isParsing={recipients.isParsing}
          error={recipients.error ?? fieldError('recipients')}
          onFileSelected={recipients.select}
          onRemove={recipients.remove}
          hint="Addresses are parsed and verified on the server before scheduling."
        />
      </fieldset>

      <fieldset disabled={isSubmitting} className="space-y-4 disabled:opacity-60">
        <legend className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <CalendarClock className="h-4 w-4 text-slate-400" aria-hidden="true" />
          Delivery schedule
        </legend>

        <div className="grid gap-4 sm:grid-cols-3">
          <DateTimePicker
            id={`${id}-start`}
            label="Start time"
            value={values.startTime}
            onChange={(event) => set('startTime', event.target.value)}
            error={fieldError('startTime')}
            required
            hint="Your local time."
          />

          <Select
            id={`${id}-delay`}
            label="Delay between emails"
            options={DELAY_OPTIONS}
            value={String(values.delayBetweenEmails)}
            onChange={(event) => set('delayBetweenEmails', Number(event.target.value))}
            hint="Gap between sends."
          />

          <Input
            id={`${id}-limit`}
            label="Hourly limit"
            type="number"
            min={1}
            max={2000}
            inputMode="numeric"
            value={values.hourlyLimit}
            onChange={(event) => set('hourlyLimit', Number(event.target.value))}
            error={fieldError('hourlyLimit')}
            hint="Protects deliverability."
          />
        </div>

        {recipients.file && estimate.durationLabel ? (
          <p className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-xs text-brand-800 ring-1 ring-inset ring-brand-100">
            <Info className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {formatNumber(recipientCount)} recipients at {values.hourlyLimit}/hour will take
              roughly <strong className="font-semibold">{estimate.durationLabel}</strong>, finishing
              around{' '}
              <strong className="font-semibold">
                {estimate.completionAt ? formatDateTime(estimate.completionAt) : '—'}
              </strong>
              .
            </span>
          </p>
        ) : null}
      </fieldset>

      {hideActions ? null : (
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
          {onCancel ? (
            <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
          ) : null}
          <Button
            type="submit"
            isLoading={isSubmitting}
            leftIcon={<Send className="h-4 w-4" aria-hidden="true" />}
          >
            Schedule Emails
          </Button>
        </div>
      )}
    </form>
  );
}
