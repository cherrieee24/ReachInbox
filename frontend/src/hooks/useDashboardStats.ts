import { useQuery } from '@tanstack/react-query';
import { dashboardService } from '../services/dashboard.service';

export const dashboardKeys = { stats: ['dashboard', 'stats'] as const };

export function useDashboardStats() {
  return useQuery({
    queryKey: dashboardKeys.stats,
    queryFn: () => dashboardService.stats(),
    // Queue counts move on their own, so keep them reasonably fresh.
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
