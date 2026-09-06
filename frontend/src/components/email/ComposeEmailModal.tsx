import { Send } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { routes } from '../layout/navigation';
import { useToast } from '../../context/ToastContext';
import { useScheduleEmails } from '../../hooks/useEmails';
import type { ScheduleResult } from '../../types/email';
import { apiErrorMessage, apiFieldErrors } from '../../utils/apiErrorMessage';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { ComposeForm } from './ComposeForm';
import { ComposeSuccess } from './ComposeSuccess';
import { ComposeSummary, type ComposeSummaryData } from './ComposeSummary';

export interface ComposeEmailModalProps {
  open: boolean;
  onClose: () => void;
}

const FORM_ID = 'compose-email-form';

const EMPTY_SUMMARY: ComposeSummaryData = {
  recipientCount: 0,
  startTime: '',
  delayBetweenEmails: 30,
  hourlyLimit: 100,
  estimatedCompletionAt: null,
};

/**
 * Success is reported only after the API returns 201. There is no optimistic
 * update here on purpose: a campaign either exists on the server or it does
 * not, and a premature "Scheduled" is a claim the user would act on.
 */
export function ComposeEmailModal({ open, onClose }: ComposeEmailModalProps) {
  const toast = useToast();
  const navigate = useNavigate();
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<ComposeSummaryData>(EMPTY_SUMMARY);
  const [result, setResult] = useState<ScheduleResult | null>(null);
  // Remounts the form so "Compose another" starts genuinely empty.
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

  // Start each visit with a clean slate. Done during render rather than in an
  // effect so the dialog never paints the previous visit's state first.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setServerErrors({});
      setResult(null);
      setSummary(EMPTY_SUMMARY);
    }
  }

  const handleChange = useCallback((next: ComposeSummaryData) => setSummary(next), []);

  const composeAnother = () => {
    setResult(null);
    setSummary(EMPTY_SUMMARY);
    setFormKey((key) => key + 1);
  };

  const viewScheduled = () => {
    onClose();
    navigate(routes.scheduled);
  };

  const busy = schedule.isPending;

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      size="xl"
      title={result ? 'Campaign scheduled' : 'Compose New Email'}
      description={
        result
          ? undefined
          : 'Upload a recipient list, write your message and set the delivery pace.'
      }
      footer={
        result ? (
          <Button variant="outline" onClick={onClose} fullWidth>
            Done
          </Button>
        ) : (
          <div className="flex w-full flex-col gap-3">
            {/* The delivery settings sit below the fold, so the recap lives
                here where it is visible at the moment of committing. */}
            <ComposeSummary {...summary} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                form={FORM_ID}
                isLoading={busy}
                leftIcon={<Send className="h-4 w-4" aria-hidden="true" />}
              >
                Schedule Emails
              </Button>
            </div>
          </div>
        )
      }
    >
      {result ? (
        <ComposeSuccess
          result={result}
          onViewScheduled={viewScheduled}
          onComposeAnother={composeAnother}
        />
      ) : (
        <ComposeForm
          key={formKey}
          formId={FORM_ID}
          hideActions
          isSubmitting={busy}
          serverErrors={serverErrors}
          onChange={handleChange}
          onSubmit={(request) =>
            // One key per submission attempt: a retry of the same click
            // resolves to the campaign the first attempt created.
            schedule.mutate({ ...request, idempotencyKey: crypto.randomUUID() })
          }
        />
      )}
    </Modal>
  );
}
