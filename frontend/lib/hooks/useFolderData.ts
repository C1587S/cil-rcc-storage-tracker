import { useQuery, UseQueryResult } from '@tanstack/react-query'
import { foldersApi } from '@/lib/api'
import type { FolderBreakdown, FolderTreeNode, DistributionResponse } from '@/lib/types'

export function useFolderData(
  path: string,
  snapshot: string | null,
  depth: number = 1
): UseQueryResult<FolderBreakdown> {
  return useQuery({
    queryKey: ['folder', path, snapshot, depth],
    queryFn: () => foldersApi.getBreakdown(path, snapshot!, depth),
    enabled: !!snapshot && !!path,
    staleTime: 2 * 60 * 60 * 1000, // 2 hours
  })
}

export function useFolderTree(
  path: string,
  snapshot: string | null
): UseQueryResult<FolderTreeNode> {
  return useQuery({
    queryKey: ['folder-tree', path, snapshot],
    queryFn: () => foldersApi.getTree(path, snapshot!),
    enabled: !!snapshot && !!path,
    staleTime: 2 * 60 * 60 * 1000,
  })
}

export function useFolderTypeDistribution(
  path: string,
  snapshot: string | null
): UseQueryResult<DistributionResponse> {
  return useQuery({
    queryKey: ['folder-types', path, snapshot],
    queryFn: () => foldersApi.getTypeDistribution(path, snapshot!),
    enabled: !!snapshot && !!path,
    staleTime: 2 * 60 * 60 * 1000,
  })
}
