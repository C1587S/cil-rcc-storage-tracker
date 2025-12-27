import { useQuery } from '@tanstack/react-query'
import { buildVoronoiTree, type VoronoiNode } from '@/lib/voronoi-data-adapter'

/**
 * Options for useVoronoiDataOnTheFly hook
 */
interface UseVoronoiDataOnTheFlyOptions {
  selectedSnapshot: string | null
  effectivePath: string
}

/**
 * React hook for on-the-fly voronoi tree computation (legacy mode).
 *
 * LEGACY ARCHITECTURE:
 * - Computes voronoi tree on-the-fly using buildVoronoiTree()
 * - Fetches from /api/browse and /api/contents endpoints
 * - No precomputation - builds tree in real-time
 * - Uses React Query for caching (5-minute stale time)
 *
 * BEHAVIOR:
 * 1. Calls buildVoronoiTree() with selected snapshot and path
 * 2. Builds hierarchical tree with preview depth 2
 * 3. Returns tree data for rendering
 *
 * This hook is used for debugging/comparison with the new ClickHouse-based
 * incremental loading approach (useVoronoiData).
 *
 * @param options - Configuration options
 * @returns Query result with data, loading states, and error
 */
export function useVoronoiDataOnTheFly({
  selectedSnapshot,
  effectivePath,
}: UseVoronoiDataOnTheFlyOptions) {
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['voronoi-tree-on-the-fly', selectedSnapshot, effectivePath],
    queryFn: async () => {
      if (!selectedSnapshot || !effectivePath) {
        throw new Error('Missing snapshot or path')
      }

      // On-the-fly computation using legacy buildVoronoiTree
      return buildVoronoiTree(selectedSnapshot, effectivePath, 2, 1000)
    },
    enabled: !!selectedSnapshot && !!effectivePath,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes (previously cacheTime)
  })

  return {
    data,
    isLoading,
    isFetching,
    error,
  }
}
