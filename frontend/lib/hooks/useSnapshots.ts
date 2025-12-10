import { useQuery, UseQueryResult } from '@tanstack/react-query'
import { snapshotsApi } from '@/lib/api'
import type { SnapshotListResponse, Snapshot, SnapshotComparison } from '@/lib/types'

export function useSnapshots(): UseQueryResult<SnapshotListResponse> {
  return useQuery({
    queryKey: ['snapshots'],
    queryFn: () => snapshotsApi.list(),
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
    gcTime: 24 * 60 * 60 * 1000,
  })
}

export function useSnapshot(date: string): UseQueryResult<Snapshot> {
  return useQuery({
    queryKey: ['snapshot', date],
    queryFn: () => snapshotsApi.get(date),
    enabled: !!date,
    staleTime: 24 * 60 * 60 * 1000,
  })
}

export function useLatestSnapshot(): UseQueryResult<Snapshot> {
  return useQuery({
    queryKey: ['snapshot', 'latest'],
    queryFn: () => snapshotsApi.latest(),
    staleTime: 24 * 60 * 60 * 1000,
  })
}

export function useSnapshotComparison(
  from: string | null,
  to: string | null
): UseQueryResult<SnapshotComparison> {
  return useQuery({
    queryKey: ['snapshot-comparison', from, to],
    queryFn: () => snapshotsApi.compare(from!, to!),
    enabled: !!from && !!to,
    staleTime: 4 * 60 * 60 * 1000, // 4 hours
  })
}
