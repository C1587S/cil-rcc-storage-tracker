import { apiClient } from './client'
import type { SnapshotListResponse, Snapshot, SnapshotComparison } from '@/lib/types'

interface SnapshotInfo {
  snapshot: Snapshot
  breakdown_by_dir?: Record<string, any>
  breakdown_by_type?: Record<string, any>
  largest_files?: any[]
}

export const snapshotsApi = {
  list: (): Promise<SnapshotListResponse> => {
    return apiClient.get<SnapshotListResponse>('/api/snapshots/')
  },

  get: async (date: string): Promise<Snapshot> => {
    const info = await apiClient.get<SnapshotInfo>(`/api/snapshots/${date}`)
    return info.snapshot
  },

  latest: (): Promise<Snapshot> => {
    return apiClient.get<Snapshot>('/api/snapshots/latest')
  },

  compare: (from: string, to: string): Promise<SnapshotComparison> => {
    return apiClient.get<SnapshotComparison>('/api/snapshots/compare/', {
      from,
      to,
    })
  },
}
