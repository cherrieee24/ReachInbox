import { CalendarClock, Gauge, Timer, Users } from 'lucide-react';
import { formatDateTime, formatNumber } from '../../utils/format';

export interface ComposeSummaryData {
  recipientCount: number;
  startTime: string;
  delayBetweenEmails: number;
  hourlyLimit: number;
  /** Null until a recipient list has been uploaded. */
  estimatedCompletionAt: string | null;
}

function paceLabel(seconds: number): string {
  if (seconds < 60) return `one every ${seconds}s`;
  const minutes = seconds / 60;
  return `one every ${minutes % 1 === 0 ? minutes : minutes.toFixed(1)} min`;
}

interface FactProps {
  icon: typeof Users;
  label: string;
  value: string;
  muted?: boolean;
}

function Fact({ icon: Icon, label, value, muted = false }: FactProps) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${muted ? 'text-slate-300' : 'text-slate-400'}`}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
        <dd className={`truncate text-sm font-medium ${muted ? 'text-slate-400' : 'text-slate-900'}`}>
          {value}
        </dd>
      </div>
    </div>
  );
}

/**
 * A standing answer to "what am I about to send, to whom, and when?".
 *
 * It lives in the dialog footer rather than in the scrolling form, because the
 * delivery settings sit below the fold on a laptop — the recap has to be
 * visible at the moment the user reaches for Schedule.
 */
export function ComposeSummary({
  recipientCount,
  startTime,
  delayBetweenEmails,
  hourlyLimit,
  estimatedCompletionAt,
}: ComposeSummaryData) {
  const hasRecipients = recipientCount > 0;
  const start = startTime ? formatDateTime(new Date(startTime).toISOString()) : 'Not set';

  return (
    <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200 sm:grid-cols-4">
      <Fact
        icon={Users}
        label="Recipients"
        muted={!hasRecipients}
        value={hasRecipients ? formatNumber(recipientCount) : 'Upload a list'}
      />
      <Fact icon={CalendarClock} label="Starts" value={start} muted={!startTime} />
      <Fact icon={Timer} label="Pace" value={paceLabel(delayBetweenEmails)} />
      <Fact
        icon={Gauge}
        label="Hourly limit"
        value={
          hasRecipients && estimatedCompletionAt
            ? `${formatNumber(hourlyLimit)}/hr · ends ${formatDateTime(estimatedCompletionAt)}`
            : `${formatNumber(hourlyLimit)}/hr`
        }
      />
    </dl>
  );
}
