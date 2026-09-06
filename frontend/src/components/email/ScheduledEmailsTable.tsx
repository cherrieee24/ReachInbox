import { ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react';
import type { ScheduledEmail } from '../../types/email';
import { formatDateTime, formatRelative } from '../../utils/format';
import { Dropdown, DropdownItem } from '../ui/Dropdown';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '../ui/Table';
import { RecipientCell } from './RecipientCell';
import { StatusBadge } from './StatusBadge';

export interface ScheduledEmailsTableProps {
  emails: ScheduledEmail[];
  onCancelCampaign?: (emailJobId: string, subject: string) => void;
  isCancelling?: boolean;
}

export function ScheduledEmailsTable({
  emails,
  onCancelCampaign,
  isCancelling = false,
}: ScheduledEmailsTableProps) {
  const rowMenu = (email: ScheduledEmail) =>
    onCancelCampaign ? (
      <Dropdown
        label={`Actions for ${email.email}`}
        trigger={() => (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
      >
        <DropdownItem
          tone="danger"
          disabled={isCancelling}
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          onSelect={() => onCancelCampaign(email.emailJob.id, email.emailJob.subject)}
        >
          Cancel this campaign
        </DropdownItem>
      </Dropdown>
    ) : null;

  return (
    <>
      {/* Table from md up, stacked cards below so nothing overflows on phones. */}
      <div className="hidden md:block">
        <TableContainer>
          <Table>
            <caption className="sr-only">Scheduled emails</caption>
            <THead>
              <TR className="hover:bg-slate-50">
                <TH className="w-[30%]">Email</TH>
                <TH className="w-[34%]">Subject</TH>
                <TH className="w-[20%]">Scheduled Time</TH>
                <TH className="w-[12%]">Status</TH>
                <TH className="w-[4%] text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {emails.map((email) => (
                <TR key={email.id}>
                  <TD>
                    <RecipientCell email={email.email} />
                  </TD>
                  <TD className="max-w-0">
                    <p className="truncate text-slate-900">{email.emailJob.subject}</p>
                  </TD>
                  <TD>
                    <p className="whitespace-nowrap text-slate-900">
                      {formatDateTime(email.scheduledAt)}
                    </p>
                    <p className="text-xs text-slate-500">{formatRelative(email.scheduledAt)}</p>
                  </TD>
                  <TD>
                    <StatusBadge status={email.status} />
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end">{rowMenu(email)}</div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      </div>

      <ul className="divide-y divide-slate-200 md:hidden">
        {emails.map((email) => (
          <li key={email.id} className="flex items-start gap-3 px-4 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <RecipientCell email={email.email} />
              <p className="truncate text-sm text-slate-700">{email.emailJob.subject}</p>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={email.status} />
                <span className="text-xs text-slate-500">{formatDateTime(email.scheduledAt)}</span>
              </div>
            </div>
            {rowMenu(email)}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Shared by the sent table: a link to the captured message, when there is one.
 *
 * The URL originates from our own mail transport rather than user input, but
 * it is stored and returned as data — so the scheme is checked before it
 * becomes an href. Without this, a `javascript:` value in that column would
 * execute on click.
 */
export function PreviewLink({ url }: { url: string | null }) {
  if (!url) return null;

  let safe: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    safe = parsed.toString();
  } catch {
    return null;
  }
  return (
    <a
      href={safe}
      target="_blank"
      rel="noreferrer noopener"
      className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
    >
      View message
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}
