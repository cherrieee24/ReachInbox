import { ArrowLeft } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ComposeForm } from '../components/email/ComposeForm';
import { ComposeSuccess } from '../components/email/ComposeSuccess';
import { ComposeSummary, type ComposeSummaryData } from '../components/email/ComposeSummary';
import { routes } from '../components/layout/navigation';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { useToast } from '../context/ToastContext';
import { useScheduleEmails } from '../hooks/useEmails';
import type { ScheduleResult } from '../types/email';
import { apiErrorMessage, apiFieldErrors } from '../utils/apiErrorMessage';

const EMPTY_SUMMARY: ComposeSummaryData = {
  recipientCount: 0,
  startTime: '',
  delayBetweenEmails: 30,
  hourlyLimit: 100,
  estimatedCompletionAt: null,
};

/** Full-page variant of the compose experience, for deep links and mobile. */
export default function ComposePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<ComposeSummaryData>(EMPTY_SUMMARY);
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [formKey, setFormKey] = useState(0);

  const schedule = useScheduleEmails({
    onSuccess: (scheduled) => {
      setServerErrors({});
      setResult(scheduled);
    },
    onError: (error) => {
      setServerErrors(apiFieldErrors(error));
      toast.error('Could not schedule campaign', apiErrorMessage(error));
    },
  });

  const handleChange = useCallback((next: ComposeSummaryData) => setSummary(next), []);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </button>

      <Card>
        <CardHeader
          title={result ? 'Campaign scheduled' : 'Compose New Email'}
          description={
            result ? undefined : 'Upload a recipient list, write your message and set the delivery pace.'
          }
        />
        <CardBody>
          {result ? (
            <ComposeSuccess
              result={result}
              onViewScheduled={() => navigate(routes.scheduled)}
              onComposeAnother={() => {
                setResult(null);
                setSummary(EMPTY_SUMMARY);
                setFormKey((key) => key + 1);
              }}
            />
          ) : (
            <div className="space-y-5">
              <ComposeForm
                key={formKey}
                onCancel={() => navigate(-1)}
                isSubmitting={schedule.isPending}
                serverErrors={serverErrors}
                onChange={handleChange}
                hideActions
                formId="compose-page-form"
                onSubmit={(request) =>
                  schedule.mutate({ ...request, idempotencyKey: crypto.randomUUID() })
                }
              />
              <div className="space-y-3 border-t border-slate-200 pt-5">
                <ComposeSummary {...summary} />
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => navigate(-1)}
                    disabled={schedule.isPending}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    form="compose-page-form"
                    disabled={schedule.isPending}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-brand-300"
                  >
                    {schedule.isPending ? 'Scheduling…' : 'Schedule Emails'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
