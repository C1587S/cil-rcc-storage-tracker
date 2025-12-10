import { apiClient } from './client'
import type { SnapshotListResponse, Snapshot, SnapshotComparison } from '@/lib/types'

export const snapshotsApi = {
  list: (): Promise<SnapshotListResponse> => {
    return apiClient.get<SnapshotListResponse>('/api/snapshots')
  },

  get: (date: string): Promise<Snapshot> => {
    return apiClient.get<Snapshot>(`/api/snapshots/${date}`)
  },

  latest: (): Promise<Snapshot> => {
    return apiClient.get<Snapshot>('/api/snapshots/latest')
  },

  compare: (from: string, to: string): Promise<SnapshotComparison> => {
    return apiClient.get<SnapshotComparison>('/api/snapshots/compare', {
      from,
      to,
    })
  },
}
