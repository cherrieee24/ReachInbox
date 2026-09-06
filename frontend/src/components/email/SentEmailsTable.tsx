import type { SentEmail } from '../../types/email';
import { formatDateTime, formatRelative } from '../../utils/format';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '../ui/Table';
import { RecipientCell } from './RecipientCell';
import { PreviewLink } from './ScheduledEmailsTable';
import { StatusBadge } from './StatusBadge';

export interface SentEmailsTableProps {
  emails: SentEmail[];
}

export function SentEmailsTable({ emails }: SentEmailsTableProps) {
  return (
    <>
      <div className="hidden md:block">
        <TableContainer>
          <Table>
            <caption className="sr-only">Sent emails</caption>
            <THead>
              <TR className="hover:bg-slate-50">
                <TH className="w-[30%]">Email</TH>
                <TH className="w-[36%]">Subject</TH>
                <TH className="w-[22%]">Sent Time</TH>
                <TH className="w-[12%]">Status</TH>
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
                    {email.errorMessage ? (
                      <p className="truncate text-xs text-red-600">{email.errorMessage}</p>
                    ) : (
                      <PreviewLink url={email.previewUrl} />
                    )}
                  </TD>
                  <TD>
                    <p className="whitespace-nowrap text-slate-900">
                      {email.sentAt ? formatDateTime(email.sentAt) : '—'}
                    </p>
                    {email.sentAt ? (
                      <p className="text-xs text-slate-500">{formatRelative(email.sentAt)}</p>
                    ) : null}
                  </TD>
                  <TD>
                    <StatusBadge status={email.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      </div>

      <ul className="divide-y divide-slate-200 md:hidden">
        {emails.map((email) => (
          <li key={email.id} className="space-y-2 px-4 py-4">
            <RecipientCell email={email.email} />
            <p className="truncate text-sm text-slate-700">{email.emailJob.subject}</p>
            {email.errorMessage ? (
              <p className="text-xs text-red-600">{email.errorMessage}</p>
            ) : (
              <PreviewLink url={email.previewUrl} />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={email.status} />
              <span className="text-xs text-slate-500">
                {email.sentAt ? formatDateTime(email.sentAt) : '—'}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
