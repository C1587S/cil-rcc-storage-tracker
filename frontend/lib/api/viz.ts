import { apiClient } from './client'
import type { TreemapData, DiskUsageItem } from '@/lib/types'

export const vizApi = {
  treemap: (
    path: string,
    snapshot: string,
    depth: number = 2
  ): Promise<TreemapData> => {
    return apiClient.get<TreemapData>('/api/viz/treemap', {
      path,
      snapshot,
      depth,
    })
  },

  diskUsage: (path: string, snapshot: string): Promise<{ items: DiskUsageItem[] }> => {
    return apiClient.get<{ items: DiskUsageItem[] }>('/api/viz/disk-usage', {
      path,
      snapshot,
    })
  },

  timeline: (
    path: string,
    startDate: string,
    endDate: string
  ): Promise<{ data_points: Array<{ date: string; size: number; file_count: number }> }> => {
    return apiClient.get('/api/viz/timeline', {
      path,
      start: startDate,
      end: endDate,
    })
  },

  distribution: (
    snapshot: string,
    type: 'size' | 'type' = 'size'
  ): Promise<{ distribution: Array<unknown> }> => {
    return apiClient.get('/api/viz/distribution', {
      snapshot,
      type,
    })
  },
}
