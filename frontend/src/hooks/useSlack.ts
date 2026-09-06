import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { slackService } from '../services/slack.service';
import type { SlackStatus } from '../types/user';

export const SLACK_QUERY_KEY = ['slack', 'status'] as const;

export interface UseSlackResult {
  status: SlackStatus | undefined;
  isLoading: boolean;
  isError: boolean;
  connect: () => void;
  disconnect: () => void;
  isDisconnecting: boolean;
  refresh: () => void;
}

export function useSlack(): UseSlackResult {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: SLACK_QUERY_KEY,
    queryFn: () => slackService.status(),
    staleTime: 60_000,
  });

  const disconnectMutation = useMutation({
    mutationFn: () => slackService.disconnect(),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: SLACK_QUERY_KEY }),
  });

  return {
    status: query.data,
    isLoading: query.isPending,
    isError: query.isError,
    // A full-page navigation, because Slack's consent screen cannot be framed.
    connect: () => window.location.assign(slackService.connectUrl()),
    disconnect: () => disconnectMutation.mutate(),
    isDisconnecting: disconnectMutation.isPending,
    refresh: () => void queryClient.invalidateQueries({ queryKey: SLACK_QUERY_KEY }),
  };
}
