import { endpoints, http } from '../api';
import type { ListQuery, PaginatedResponse } from '../types/api';
import type {
  EmailSearchHit,
  RecipientFileReport,
  ScheduleRequest,
  ScheduleResult,
  ScheduledEmail,
  SentEmail,
} from '../types/email';

export interface SearchQuery extends ListQuery {
  q: string;
}

export const emailService = {
  listScheduled(query: ListQuery = {}): Promise<PaginatedResponse<ScheduledEmail>> {
    return http.get<ScheduledEmail[]>(endpoints.emails.scheduled, {
      params: query,
    }) as Promise<PaginatedResponse<ScheduledEmail>>;
  },

  listSent(query: ListQuery = {}): Promise<PaginatedResponse<SentEmail>> {
    return http.get<SentEmail[]>(endpoints.emails.sent, {
      params: query,
    }) as Promise<PaginatedResponse<SentEmail>>;
  },

  search(query: SearchQuery): Promise<PaginatedResponse<EmailSearchHit>> {
    return http.get<EmailSearchHit[]>(endpoints.emails.search, {
      params: query,
    }) as Promise<PaginatedResponse<EmailSearchHit>>;
  },

  /**
   * The server is the authority on which addresses are valid. The browser
   * parses only to show something immediately; these counts are what count.
   */
  async validateRecipientFile(content: string, filename: string): Promise<RecipientFileReport> {
    const { data } = await http.post<RecipientFileReport, { content: string; filename: string }>(
      endpoints.emails.validateFile,
      { content, filename },
    );
    return data;
  },

  /**
   * `idempotencyKey` makes a retried or double-clicked submission resolve to
   * the campaign the first attempt created, instead of a second one.
   */
  async schedule(payload: ScheduleRequest, idempotencyKey?: string): Promise<ScheduleResult> {
    const { data } = await http.post<ScheduleResult, ScheduleRequest>(
      endpoints.emails.schedule,
      payload,
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
    );
    return data;
  },

  async cancel(id: string): Promise<void> {
    await http.delete<null>(endpoints.emails.byId(id));
  },
};
