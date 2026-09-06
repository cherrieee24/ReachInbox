import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SlackCard } from '../SlackCard';
import { renderWithProviders } from '../../../test/utils';
import type { SlackStatus } from '../../../types/user';

const status = vi.hoisted(() => vi.fn());
const disconnect = vi.hoisted(() => vi.fn());
const connectUrl = vi.hoisted(() => vi.fn(() => '/api/slack/connect'));
vi.mock('../../../services/slack.service', () => ({
  slackService: { status, disconnect, connectUrl },
}));

const assign = vi.fn();
vi.stubGlobal('location', { ...window.location, assign });

const state = (over: Partial<SlackStatus> = {}): SlackStatus => ({
  connected: false,
  configured: true,
  ...over,
});

describe('Slack connection UI', () => {
  it('offers to connect when no workspace is linked', async () => {
    status.mockResolvedValue(state());
    renderWithProviders(<SlackCard />);

    expect(await screen.findByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect slack/i })).toBeEnabled();
  });

  it('names the workspace and channel once connected', async () => {
    status.mockResolvedValue(
      state({ connected: true, teamName: 'Acme HQ', channelName: '#alerts' }),
    );
    renderWithProviders(<SlackCard />);

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('#alerts')).toBeInTheDocument();
    expect(screen.getByText(/acme hq/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  it('starts the install with a full-page navigation', async () => {
    status.mockResolvedValue(state());
    renderWithProviders(<SlackCard />);

    await userEvent.click(await screen.findByRole('button', { name: /connect slack/i }));
    // Slack's consent screen cannot be framed, so this must leave the SPA.
    expect(assign).toHaveBeenCalledWith('/api/slack/connect');
  });

  it('disconnects and refreshes the status', async () => {
    status.mockResolvedValueOnce(state({ connected: true, teamName: 'Acme HQ' }));
    disconnect.mockResolvedValue({ disconnected: 1 });
    status.mockResolvedValue(state({ connected: false }));

    renderWithProviders(<SlackCard />);
    await userEvent.click(await screen.findByRole('button', { name: /disconnect/i }));

    await waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
    expect(await screen.findByText('Disconnected')).toBeInTheDocument();
  });

  it('disables connecting when the server has no Slack credentials', async () => {
    status.mockResolvedValue(state({ configured: false }));
    renderWithProviders(<SlackCard />);

    // Awaited: the hint only renders once the status query resolves, and the
    // button is already disabled while loading.
    expect(await screen.findByText(/have not been configured/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect slack/i })).toBeDisabled();
  });

  it('confirms a successful install after the OAuth redirect', async () => {
    status.mockResolvedValue(state({ connected: true, teamName: 'Acme HQ', channelName: '#alerts' }));
    renderWithProviders(<SlackCard outcome="connected" />);

    expect(await screen.findByRole('status')).toHaveTextContent(/slack connected/i);
  });

  it('explains a failed install', async () => {
    status.mockResolvedValue(state());
    renderWithProviders(<SlackCard outcome="access_denied" />);

    expect(await screen.findByRole('status')).toHaveTextContent(/cancelled the slack install/i);
  });
});
