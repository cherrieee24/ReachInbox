import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emailService } from '../services/email.service';
import type { ListQuery } from '../types/api';
import type { ScheduleRequest, ScheduleResult } from '../types/email';

export const emailKeys = {
  all: ['emails'] as const,
  scheduled: (query: ListQuery) => ['emails', 'scheduled', query] as const,
  sent: (query: ListQuery) => ['emails', 'sent', query] as const,
  search: (query: ListQuery & { q: string }) => ['emails', 'search', query] as const,
};

/** `keepPreviousData` stops the table flashing empty while a page loads. */
export function useScheduledEmails(query: ListQuery) {
  return useQuery({
    queryKey: emailKeys.scheduled(query),
    queryFn: () => emailService.listScheduled(query),
    placeholderData: keepPreviousData,
  });
}

export function useSentEmails(query: ListQuery) {
  return useQuery({
    queryKey: emailKeys.sent(query),
    queryFn: () => emailService.listSent(query),
    placeholderData: keepPreviousData,
  });
}

export function useEmailSearch(query: ListQuery & { q: string }, enabled: boolean) {
  return useQuery({
    queryKey: emailKeys.search(query),
    queryFn: () => emailService.search(query),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export interface UseScheduleEmailsOptions {
  onSuccess?: (result: ScheduleResult) => void;
  onError?: (error: unknown) => void;
}

/**
 * Creates a campaign. Deliberately not optimistic: a campaign either exists on
 * the server or it does not, and showing a success the backend never confirmed
 * would be a lie the user acts on. The lists are refetched only after the API
 * returns 201.
 */
export function useScheduleEmails(options: UseScheduleEmailsOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ScheduleRequest & { idempotencyKey?: string }) => {
      const { idempotencyKey, ...body } = payload;
      return emailService.schedule(body, idempotencyKey);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: emailKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      options.onSuccess?.(result);
    },
    onError: (error) => options.onError?.(error),
  });
}

export interface UseCancelEmailJobOptions {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export function useCancelEmailJob(options: UseCancelEmailJobOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => emailService.cancel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: emailKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      options.onSuccess?.();
    },
    onError: (error) => options.onError?.(error),
  });
}
