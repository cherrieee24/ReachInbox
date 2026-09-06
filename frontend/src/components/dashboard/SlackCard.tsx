import { AlertCircle, CheckCircle2, Slack, Unplug } from 'lucide-react';
import { useSlack } from '../../hooks/useSlack';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';

export interface SlackCardProps {
  /** Outcome code from ?slack=… after the OAuth redirect. */
  outcome?: string | null;
}

const OUTCOMES: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  connected: { tone: 'ok', text: 'Slack connected. Rate-limit alerts will post to your channel.' },
  access_denied: { tone: 'error', text: 'You cancelled the Slack install.' },
  invalid_state: { tone: 'error', text: 'That install link could not be verified. Try again.' },
  missing_code: { tone: 'error', text: 'Slack did not return an authorisation code.' },
  not_configured: { tone: 'error', text: 'Slack is not configured on this server yet.' },
  failed: { tone: 'error', text: 'Could not complete the Slack install. Try again.' },
};

export function SlackCard({ outcome }: SlackCardProps) {
  const slack = useSlack();
  const message = outcome ? OUTCOMES[outcome] : undefined;
  const connected = slack.status?.connected ?? false;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
      {/* Stacks below sm: side by side, the action button leaves the text
          column ~90px wide and the description wraps a word per line. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          <Slack className="h-5 w-5" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Slack</h3>
            {slack.isLoading ? (
              <Skeleton className="h-5 w-24 rounded-full" />
            ) : (
              <Badge tone={connected ? 'success' : 'neutral'}>
                {connected ? 'Connected' : 'Disconnected'}
              </Badge>
            )}
          </div>

          <p className="mt-1 text-sm text-slate-500">
            {slack.isLoading ? (
              <Skeleton className="mt-1 h-3 w-64" />
            ) : connected ? (
              <>
                Posting to{' '}
                <span className="font-medium text-slate-700">
                  {slack.status?.channelName ?? 'your chosen channel'}
                </span>{' '}
                in {slack.status?.teamName}.
              </>
            ) : (
              'Get an alert when a sender hits its hourly limit and emails are rescheduled.'
            )}
          </p>

          {message ? (
            <p
              role="status"
              className={
                message.tone === 'ok'
                  ? 'mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-inset ring-emerald-200'
                  : 'mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-inset ring-red-200'
              }
            >
              {message.tone === 'ok' ? (
                <CheckCircle2 className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {message.text}
            </p>
          ) : null}

          {slack.status && !slack.status.configured ? (
            <p className="mt-3 text-xs text-slate-500">
              Not available yet — Slack credentials have not been configured on the server.
            </p>
          ) : null}
        </div>

        <div className="shrink-0">
          {connected ? (
            <Button
              variant="outline"
              size="sm"
              fullWidth
              className="sm:w-auto"
              onClick={slack.disconnect}
              isLoading={slack.isDisconnecting}
              leftIcon={<Unplug className="h-4 w-4" aria-hidden="true" />}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              fullWidth
              className="sm:w-auto"
              onClick={slack.connect}
              disabled={slack.isLoading || slack.status?.configured === false}
              leftIcon={<Slack className="h-4 w-4" aria-hidden="true" />}
            >
              Connect Slack
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
