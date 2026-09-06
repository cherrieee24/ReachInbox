import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduledEmailsView } from '../ScheduledEmailsPage';
import { SentEmailsView } from '../SentEmailsPage';
import { renderWithProviders } from '../../test/utils';
import { ApiError } from '../../api';
import type { Email } from '../../types/email';

const listScheduled = vi.hoisted(() => vi.fn());
const listSent = vi.hoisted(() => vi.fn());
vi.mock('../../services/email.service', () => ({
  emailService: { listScheduled, listSent, cancel: vi.fn() },
}));
vi.mock('../../context/ComposeContext', () => ({
  useCompose: () => ({ isOpen: false, open: vi.fn(), close: vi.fn() }),
}));

const row = (over: Partial<Email> = {}): Email => ({
  id: 'r1',
  email: 'priya.sharma@northwind.io',
  status: 'SCHEDULED',
  scheduledAt: '2030-01-01T10:00:00.000Z',
  sentAt: null,
  errorMessage: null,
  attempts: 0,
  providerMessageId: null,
  previewUrl: null,
  emailJob: { id: 'j1', subject: 'Quarterly product update' },
  ...over,
});

const page = (data: Email[]) => ({
  success: true as const,
  data,
  meta: { page: 1, pageSize: 10, totalItems: data.length, totalPages: 1 },
});

describe('Scheduled emails table', () => {
  it('renders the four required columns', async () => {
    listScheduled.mockResolvedValue(page([row()]));
    renderWithProviders(<ScheduledEmailsView />);

    for (const header of ['Email', 'Subject', 'Scheduled Time', 'Status']) {
      expect(await screen.findByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(await screen.findAllByText('priya.sharma@northwind.io')).not.toHaveLength(0);
    expect(await screen.findAllByText('Quarterly product update')).not.toHaveLength(0);
    expect(await screen.findAllByText('Scheduled')).not.toHaveLength(0);
  });

  it('shows a skeleton while loading, not an empty table', () => {
    listScheduled.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<ScheduledEmailsView />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('invites the first campaign when there is nothing scheduled', async () => {
    listScheduled.mockResolvedValue(page([]));
    renderWithProviders(<ScheduledEmailsView />);

    expect(await screen.findByText(/no scheduled emails yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /compose new email/i })).toBeInTheDocument();
  });

  it('explains a failure and offers a retry', async () => {
    listScheduled.mockRejectedValue(
      new ApiError({ message: 'Service unavailable', kind: 'server', status: 500 }),
    );
    renderWithProviders(<ScheduledEmailsView />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load your emails/i);
    expect(alert).toHaveTextContent(/service unavailable/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('asks the server for the page and filters, rather than filtering locally', async () => {
    listScheduled.mockResolvedValue(page([row()]));
    renderWithProviders(<ScheduledEmailsView />);

    await waitFor(() => expect(listScheduled).toHaveBeenCalled());
    const query = listScheduled.mock.calls[0]![0];
    expect(query).toMatchObject({ page: 1 });
    expect(typeof query.pageSize).toBe('number');
  });
});

describe('Sent emails table', () => {
  it('renders sent time and a link to the delivered message', async () => {
    listSent.mockResolvedValue(
      page([
        row({
          status: 'SENT',
          sentAt: '2026-01-01T10:00:00.000Z',
          previewUrl: 'https://ethereal.email/message/abc',
        }),
      ]),
    );
    renderWithProviders(<SentEmailsView />);

    expect(await screen.findByRole('columnheader', { name: 'Sent Time' })).toBeInTheDocument();
    const link = (await screen.findAllByRole('link', { name: /view message/i }))[0]!;
    expect(link).toHaveAttribute('href', 'https://ethereal.email/message/abc');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('shows the failure reason instead of a preview link', async () => {
    listSent.mockResolvedValue(
      page([
        row({
          status: 'FAILED',
          sentAt: '2026-01-01T10:00:00.000Z',
          errorMessage: 'Mailbox does not exist (550)',
        }),
      ]),
    );
    renderWithProviders(<SentEmailsView />);

    expect(await screen.findAllByText(/mailbox does not exist/i)).not.toHaveLength(0);
    expect(screen.queryByRole('link', { name: /view message/i })).not.toBeInTheDocument();
  });

  it('refuses to render a non-http preview URL as a link', async () => {
    listSent.mockResolvedValue(
      page([
        row({ status: 'SENT', sentAt: '2026-01-01T10:00:00.000Z', previewUrl: 'javascript:alert(1)' }),
      ]),
    );
    renderWithProviders(<SentEmailsView />);

    await screen.findAllByText('priya.sharma@northwind.io');
    expect(screen.queryByRole('link', { name: /view message/i })).not.toBeInTheDocument();
  });

  it('says nothing has been sent when the list is empty', async () => {
    listSent.mockResolvedValue(page([]));
    renderWithProviders(<SentEmailsView />);

    expect(await screen.findByText(/nothing has been sent yet/i)).toBeInTheDocument();
  });
});
