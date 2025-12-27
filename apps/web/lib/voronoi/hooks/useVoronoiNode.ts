import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { type VoronoiNode } from '@/lib/voronoi-data-adapter'

/**
 * Backend voronoi node response (from ClickHouse)
 */
export interface VoronoiNodeResponse {
  node_id: string
  parent_id: string
  path: string
  name: string
  size: number
  depth: number
  is_directory: number
  file_count: number | null
  children_ids: string[]
  is_synthetic?: number
  original_files?: Array<{
    name: string
    path: string
    size: number
  }>
}

/**
 * Extended voronoi node with incremental loading metadata
 */
interface VoronoiNodeExtended extends VoronoiNode {
  id?: string              // Node ID from backend
  isSynthetic?: boolean    // True for __files__ nodes
  childrenIds?: string[]   // IDs from backend (for lazy loading)
  originalFiles?: VoronoiNode[]
}

/**
 * Convert backend response to frontend node format
 */
function convertNode(response: VoronoiNodeResponse): VoronoiNodeExtended {
  return {
    id: response.node_id,
    name: response.name,
    path: response.path,
    size: response.size,
    depth: response.depth,
    isDirectory: Boolean(response.is_directory),
    is_directory: Boolean(response.is_directory), // Backward compatibility
    isSynthetic: Boolean(response.is_synthetic),
    file_count: response.file_count ?? 0,
    childrenIds: response.children_ids || [],
    // Children will be lazy-loaded
    children: undefined,
    // Convert original files if present (for synthetic __files__ nodes)
    originalFiles: response.original_files?.map((f) => ({
      name: f.name,
      path: f.path,
      size: f.size,
      depth: response.depth + 1,
      isDirectory: false,
      is_directory: false,
      file_count: 0,
      children: [],
    })),
  }
}

/**
 * Hook for fetching a single voronoi node from ClickHouse
 *
 * Features:
 * - Incremental loading (fetch one node at a time)
 * - Automatic caching via React Query
 * - Special handling for "root" node
 * - <10KB per request
 *
 * @param snapshot - Snapshot date (e.g., "2025-12-12")
 * @param nodeId - Node ID to fetch, or "root" for root node
 * @param enabled - Whether to enable the query (default: true)
 */
export function useVoronoiNode(
  snapshot: string | null,
  nodeId: string | null,
  enabled: boolean = true
) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['voronoi-node', snapshot, nodeId],
    queryFn: async (): Promise<VoronoiNodeExtended> => {
      if (!snapshot || !nodeId) {
        throw new Error('Snapshot and nodeId are required')
      }

      const response = await fetch(`/api/voronoi/node/${snapshot}/${nodeId}`)

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `Node not found. Run: cd clickhouse/scripts && python compute_voronoi.py ${snapshot}`
          )
        }
        throw new Error(`Failed to fetch node: ${response.statusText}`)
      }

      const data: VoronoiNodeResponse = await response.json()
      return convertNode(data)
    },
    enabled: enabled && Boolean(snapshot) && Boolean(nodeId),
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30,    // 30 minutes (renamed from cacheTime)
  })

  /**
   * Prefetch a node to warm the cache
   */
  const prefetchNode = useCallback(
    async (prefetchNodeId: string) => {
      if (!snapshot) return

      await queryClient.prefetchQuery({
        queryKey: ['voronoi-node', snapshot, prefetchNodeId],
        queryFn: async () => {
          const response = await fetch(`/api/voronoi/node/${snapshot}/${prefetchNodeId}`)
          if (!response.ok) throw new Error('Failed to prefetch node')
          const data: VoronoiNodeResponse = await response.json()
          return convertNode(data)
        },
        staleTime: 1000 * 60 * 5,
      })
    },
    [snapshot, queryClient]
  )

  return {
    node: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    prefetchNode,
  }
}

/**
 * Hook for fetching multiple nodes in parallel
 * Useful for loading all children of a node at once
 */
export function useVoronoiNodes(
  snapshot: string | null,
  nodeIds: string[],
  enabled: boolean = true
) {
  const queries = nodeIds.map((nodeId) =>
    useVoronoiNode(snapshot, nodeId, enabled)
  )

  return {
    nodes: queries.map((q) => q.node).filter(Boolean) as VoronoiNodeExtended[],
    isLoading: queries.some((q) => q.isLoading),
    isFetching: queries.some((q) => q.isFetching),
    errors: queries.map((q) => q.error).filter(Boolean),
  }
}

// Re-export types for convenience
export type { VoronoiNode, VoronoiNodeExtended }
