import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposeForm } from '../ComposeForm';
import { renderWithProviders } from '../../../test/utils';
import type { RecipientFileReport } from '../../../types/email';

const validateRecipientFile = vi.hoisted(() => vi.fn());
vi.mock('../../../services/email.service', () => ({
  emailService: { validateRecipientFile },
}));

const report = (over: Partial<RecipientFileReport> = {}): RecipientFileReport => ({
  filename: 'leads.csv',
  totalLines: 4,
  validCount: 2,
  invalidCount: 1,
  duplicateCount: 1,
  schedulableCount: 2,
  truncated: false,
  maxRecipients: 10_000,
  validEmails: ['a@x.io', 'b@y.io'],
  invalidEntries: [{ line: 3, value: 'broken', reason: 'Not a valid email address' }],
  ...over,
});

async function uploadCsv(content = 'a@x.io\nb@y.io\nbroken\na@x.io\n') {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(input, new File([content], 'leads.csv', { type: 'text/csv' }));
}

/**
 * The detected-count line interleaves a bold number with plain text, so it
 * spans several nodes. Matching on the rendered text of the whole element is
 * what a person actually reads.
 */
function detectedCount(count: number) {
  return (_content: string, element: Element | null) =>
    element?.tagName === 'P' &&
    new RegExp(`${count} email address(es)? detected`, 'i').test(element.textContent ?? '');
}

beforeEach(() => {
  validateRecipientFile.mockResolvedValue(report());
});

describe('ComposeForm validation', () => {
  it('blocks submission and names every missing field', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<ComposeForm onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('button', { name: /schedule emails/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText(/subject is required/i)).toBeInTheDocument();
    expect(screen.getByText(/email body is required/i)).toBeInTheDocument();
    expect(screen.getByText(/upload a recipient list/i)).toBeInTheDocument();
  });

  it('does not submit without recipients even when the text fields are filled', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<ComposeForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/subject/i), 'Hello');
    await userEvent.type(screen.getByLabelText(/^body/i), 'Body text');
    await userEvent.click(screen.getByRole('button', { name: /schedule emails/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText(/upload a recipient list/i)).toBeInTheDocument();
  });

  it('shows a server-side field error over the local one', async () => {
    renderWithProviders(
      <ComposeForm onSubmit={vi.fn()} serverErrors={{ subject: 'Subject is already in use' }} />,
    );
    expect(screen.getByText('Subject is already in use')).toBeInTheDocument();
  });

  it('submits an ISO start time and the server-validated addresses', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<ComposeForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/subject/i), 'Quarterly update');
    await userEvent.type(screen.getByLabelText(/^body/i), 'Hello there');
    await uploadCsv();
    await screen.findByText(detectedCount(2));

    await userEvent.click(screen.getByRole('button', { name: /schedule emails/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const payload = onSubmit.mock.calls[0]![0];
    expect(payload.subject).toBe('Quarterly update');
    // The addresses come from the server's report, not the browser's parse.
    expect(payload.recipients).toEqual(['a@x.io', 'b@y.io']);
    expect(payload.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(typeof payload.delayBetweenEmails).toBe('number');
    expect(typeof payload.hourlyLimit).toBe('number');
  });
});

describe('ComposeForm CSV upload', () => {
  it('reports the server\'s counts, not a local guess', async () => {
    renderWithProviders(<ComposeForm onSubmit={vi.fn()} />);
    await uploadCsv();

    expect(await screen.findByText(detectedCount(2))).toBeInTheDocument();
    expect(screen.getByText(/1 invalid/i)).toBeInTheDocument();
    expect(screen.getByText(/1 duplicate/i)).toBeInTheDocument();
    expect(validateRecipientFile).toHaveBeenCalledOnce();
  });

  it('lists the rows it skipped, with line numbers', async () => {
    renderWithProviders(<ComposeForm onSubmit={vi.fn()} />);
    await uploadCsv();

    await userEvent.click(await screen.findByText(/review 1 skipped row/i));
    expect(screen.getByText('Line 3')).toBeInTheDocument();
    expect(screen.getByText('broken')).toBeInTheDocument();
  });

  it('warns when the list is longer than one campaign can hold', async () => {
    validateRecipientFile.mockResolvedValue(
      report({ validCount: 12_000, schedulableCount: 10_000, truncated: true }),
    );
    renderWithProviders(<ComposeForm onSubmit={vi.fn()} />);
    await uploadCsv();

    expect(await screen.findByRole('alert')).toHaveTextContent(/first 10,000 will be scheduled/i);
  });

  it('rejects an unsupported file type before contacting the server', async () => {
    renderWithProviders(<ComposeForm onSubmit={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    // `applyAccept: false` bypasses the browser's own accept filter, so the
    // component's guard is what gets exercised — the same path a drag-and-drop
    // takes, where `accept` does not apply.
    await userEvent.upload(input, new File(['x'], 'photo.png', { type: 'image/png' }), {
      applyAccept: false,
    });

    expect(await screen.findByText(/unsupported file type/i)).toBeInTheDocument();
    expect(validateRecipientFile).not.toHaveBeenCalled();
  });

  it('surfaces a file with no usable addresses', async () => {
    validateRecipientFile.mockResolvedValue(
      report({ validCount: 0, validEmails: [], invalidCount: 3 }),
    );
    renderWithProviders(<ComposeForm onSubmit={vi.fn()} />);
    await uploadCsv();

    expect(await screen.findByText(/no valid email addresses found/i)).toBeInTheDocument();
  });

  it('lets the file be removed and re-uploaded', async () => {
    renderWithProviders(<ComposeForm onSubmit={vi.fn()} />);
    await uploadCsv();
    await screen.findByText(detectedCount(2));

    await userEvent.click(screen.getByRole('button', { name: /remove leads\.csv/i }));

    expect(screen.getByText(/drag & drop your recipient list/i)).toBeInTheDocument();
    expect(screen.queryByText(detectedCount(2))).not.toBeInTheDocument();
  });
});
