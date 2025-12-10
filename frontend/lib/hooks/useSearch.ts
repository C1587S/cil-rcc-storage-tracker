import { useQuery, UseQueryResult } from '@tanstack/react-query'
import { searchApi } from '@/lib/api'
import type { SearchParams, SearchResponse, FileEntry } from '@/lib/types'

export function useSearch(
  params: SearchParams,
  enabled: boolean = true
): UseQueryResult<SearchResponse> {
  return useQuery({
    queryKey: ['search', params],
    queryFn: () => searchApi.files(params),
    enabled: enabled && !!params.q && !!params.snapshot,
    staleTime: 1 * 60 * 60 * 1000, // 1 hour
  })
}

export function useFileHistory(path: string): UseQueryResult<{ history: FileEntry[] }> {
  return useQuery({
    queryKey: ['file-history', path],
    queryFn: () => searchApi.history(path),
    enabled: !!path,
    staleTime: 4 * 60 * 60 * 1000, // 4 hours
  })
}
