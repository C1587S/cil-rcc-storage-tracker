import { useQuery, UseQueryResult } from '@tanstack/react-query'
import { analyticsApi } from '@/lib/api'
import type {
  HeavyFilesResponse,
  InactiveFilesResponse,
  RecentActivityResponse,
} from '@/lib/types'

export function useHeavyFiles(
  snapshot: string | null,
  limit: number = 50
): UseQueryResult<HeavyFilesResponse> {
  return useQuery({
    queryKey: ['heavy-files', snapshot, limit],
    queryFn: () => analyticsApi.heavyFiles(snapshot!, limit),
    enabled: !!snapshot,
    staleTime: 4 * 60 * 60 * 1000, // 4 hours
  })
}

export function useInactiveFiles(
  snapshot: string | null,
  days: number = 365
): UseQueryResult<InactiveFilesResponse> {
  return useQuery({
    queryKey: ['inactive-files', snapshot, days],
    queryFn: () => analyticsApi.inactiveFiles(snapshot!, days),
    enabled: !!snapshot,
    staleTime: 4 * 60 * 60 * 1000,
  })
}

export function useRecentActivity(
  snapshot: string | null,
  limit: number = 50
): UseQueryResult<RecentActivityResponse> {
  return useQuery({
    queryKey: ['recent-activity', snapshot, limit],
    queryFn: () => analyticsApi.recentActivity(snapshot!, limit),
    enabled: !!snapshot,
    staleTime: 1 * 60 * 60 * 1000, // 1 hour
  })
}
