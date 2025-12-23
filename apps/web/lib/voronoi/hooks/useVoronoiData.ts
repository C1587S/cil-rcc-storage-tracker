import { useQuery } from '@tanstack/react-query'
import { buildVoronoiTree } from '@/lib/voronoi-data-adapter'

interface UseVoronoiDataOptions {
  selectedSnapshot: string | null
  effectivePath: string
}

export function useVoronoiData({ selectedSnapshot, effectivePath }: UseVoronoiDataOptions) {
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['voronoi-tree-hierarchical', selectedSnapshot, effectivePath],
    queryFn: () => {
      console.log('[QUERY] Fetching data for:', effectivePath)
      return buildVoronoiTree(selectedSnapshot!, effectivePath, 2, 1000)
    },
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
