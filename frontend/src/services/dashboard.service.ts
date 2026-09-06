import { endpoints, http } from '../api';
import type { DashboardStats } from '../types/email';

export const dashboardService = {
  async stats(): Promise<DashboardStats> {
    const { data } = await http.get<DashboardStats>(endpoints.dashboard.stats);
    return data;
  },
};
