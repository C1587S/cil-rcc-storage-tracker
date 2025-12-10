import { apiClient } from './client'
import type {
  HeavyFilesResponse,
  InactiveFilesResponse,
  RecentActivityResponse,
  GrowthResponse,
} from '@/lib/types'

export const analyticsApi = {
  heavyFiles: (snapshot: string, limit: number = 100): Promise<HeavyFilesResponse> => {
    return apiClient.get<HeavyFilesResponse>('/api/analytics/heavy-files', {
      snapshot,
      limit,
    })
  },

  inactiveFiles: (
    snapshot: string,
    days: number = 365
  ): Promise<InactiveFilesResponse> => {
    return apiClient.get<InactiveFilesResponse>('/api/analytics/inactive-files', {
      snapshot,
      days,
    })
  },

  recentActivity: (
    snapshot: string,
    limit: number = 100
  ): Promise<RecentActivityResponse> => {
    return apiClient.get<RecentActivityResponse>('/api/analytics/recent-activity', {
      snapshot,
      limit,
    })
  },

  duplicates: (snapshot: string): Promise<{ duplicates: Array<unknown> }> => {
    return apiClient.get('/api/analytics/duplicates', { snapshot })
  },

  growth: (startDate: string, endDate: string): Promise<GrowthResponse> => {
    return apiClient.get<GrowthResponse>('/api/analytics/growth', {
      start: startDate,
      end: endDate,
    })
  },
}
