import { Ban, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import type { EmailStatus } from '../../types/email';
import { Badge, type BadgeTone } from '../ui/Badge';

const config: Record<
  EmailStatus,
  { label: string; tone: BadgeTone; icon: typeof Clock; spin?: boolean }
> = {
  PENDING: { label: 'Pending', tone: 'neutral', icon: Clock },
  SCHEDULED: { label: 'Scheduled', tone: 'brand', icon: Clock },
  PROCESSING: { label: 'Processing', tone: 'warning', icon: Loader2, spin: true },
  SENT: { label: 'Sent', tone: 'success', icon: CheckCircle2 },
  FAILED: { label: 'Failed', tone: 'danger', icon: XCircle },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: Ban },
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  const entry = config[status] ?? config.PENDING;
  const { label, tone, icon: Icon, spin } = entry;
  return (
    <Badge
      tone={tone}
      icon={<Icon className={`h-3.5 w-3.5 ${spin ? 'animate-spin' : ''}`} aria-hidden="true" />}
    >
      {label}
    </Badge>
  );
}
