import { useQuery } from '@tanstack/react-query'
import { buildVoronoiTree } from '@/lib/voronoi-data-adapter'

/**
 * Options for useVoronoiData hook
 */
interface UseVoronoiDataOptions {
  selectedSnapshot: string | null
  effectivePath: string
}

/**
 * React hook for fetching voronoi tree data with React Query caching.
 * Builds hierarchical voronoi data for the current snapshot and path.
 *
 * @param options - Configuration options
 * @returns Query result with data, loading states, and error
 */
export function useVoronoiData({ selectedSnapshot, effectivePath }: UseVoronoiDataOptions) {
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['voronoi-tree-hierarchical', selectedSnapshot, effectivePath],
    queryFn: () => buildVoronoiTree(selectedSnapshot!, effectivePath, 2, 1000),
    enabled: !!selectedSnapshot && !!effectivePath,
    staleTime: 1000 * 60 * 5,
  })

  return {
    data,
    isLoading,
    isFetching,
    error,
  }
}
