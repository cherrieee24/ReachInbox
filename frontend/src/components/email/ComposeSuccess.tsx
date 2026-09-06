import { ArrowRight, CalendarClock, CheckCircle2, Mail, Users } from 'lucide-react';
import type { ScheduleResult } from '../../types/email';
import { formatDateTime, formatNumber, formatRelative } from '../../utils/format';
import { Button } from '../ui/Button';

export interface ComposeSuccessProps {
  result: ScheduleResult;
  onViewScheduled: () => void;
  onComposeAnother: () => void;
}

/**
 * Confirmation after the API has accepted a campaign.
 *
 * A toast alone disappears before it can be read and cannot restate the
 * details that matter. This spells out exactly what was committed — how many,
 * from whom, when it starts and when it should finish — so the user leaves
 * knowing what will happen rather than hoping.
 */
export function ComposeSuccess({
  result,
  onViewScheduled,
  onComposeAnother,
}: ComposeSuccessProps) {
  return (
    <div className="py-2 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
        <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
      </span>

      {/* The surrounding dialog title or card header already names this
          outcome, so the panel states the consequence instead of repeating it. */}
      <p className="mt-4 text-sm text-slate-600">
        {result.deduplicated
          ? 'This request had already been processed, so nothing was duplicated.'
          : `${formatNumber(result.totalRecipients)} email${result.totalRecipients === 1 ? '' : 's'} queued. Sending starts automatically — you can close this.`}
      </p>

      <dl className="mx-auto mt-6 max-w-md divide-y divide-slate-100 rounded-lg border border-slate-200 text-left">
        <div className="flex items-center gap-3 px-4 py-3">
          <Mail className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <dt className="sr-only">Subject</dt>
          <dd className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
            {result.subject}
          </dd>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <Users className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <dt className="text-sm text-slate-500">Recipients</dt>
          <dd className="ml-auto text-sm font-medium tabular-nums text-slate-900">
            {formatNumber(result.totalRecipients)}
          </dd>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <CalendarClock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <dt className="text-sm text-slate-500">Starts</dt>
          <dd className="ml-auto text-right text-sm font-medium text-slate-900">
            {formatDateTime(result.scheduledAt)}
            <span className="ml-1 font-normal text-slate-500">
              ({formatRelative(result.scheduledAt)})
            </span>
          </dd>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <dt className="text-sm text-slate-500">Expected finish</dt>
          <dd className="ml-auto text-sm font-medium text-slate-900">
            {formatDateTime(result.estimatedCompletionAt)}
          </dd>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <Mail className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <dt className="text-sm text-slate-500">Sending from</dt>
          <dd className="ml-auto min-w-0 truncate text-sm font-medium text-slate-900">
            {result.sender.fromEmail}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
        <Button variant="outline" onClick={onComposeAnother}>
          Compose another
        </Button>
        <Button
          onClick={onViewScheduled}
          rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
        >
          View scheduled emails
        </Button>
      </div>
    </div>
  );
}
