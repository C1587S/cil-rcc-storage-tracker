import { useEffect, useRef } from 'react'
import { type VoronoiNode } from '@/lib/voronoi-data-adapter'
import { type PartitionInfo, type VoronoiCacheEntry } from '@/lib/voronoi/utils/types'
import { VoronoiRenderer } from '@/lib/voronoi/rendering/VoronoiRenderer'

export interface UseVoronoiRendererOptions {
  data: VoronoiNode | undefined
  effectivePath: string
  isFullscreen: boolean
  navigationLock: boolean
  isFetching: boolean
  svgRef: React.RefObject<SVGSVGElement>
  containerRef: React.RefObject<HTMLDivElement>
  tooltipRef: React.RefObject<HTMLDivElement>
  voronoiCacheRef: React.RefObject<Map<string, VoronoiCacheEntry>>
  zoomRef: React.RefObject<any>
  simulationRef: React.RefObject<d3.Simulation<any, undefined> | null>
  getPartitionQuotaPercent: (size: number) => number
  getFileQuotaPercent: (fileCount: number) => number
  getParentQuotaPercent: (size: number) => number
  parentSize: number
  selectedPartition: PartitionInfo | null
  setHoveredPartition: (info: PartitionInfo | null) => void
  handleInspect: (info: PartitionInfo) => void
  performDrillDown: (path: string) => void
}

/**
 * React hook that manages voronoi rendering lifecycle
 */
export function useVoronoiRenderer(options: UseVoronoiRendererOptions): void {
  const {
    data,
    effectivePath,
    isFullscreen,
    navigationLock,
    isFetching,
    svgRef,
    containerRef,
    tooltipRef,
    voronoiCacheRef,
    zoomRef,
    simulationRef,
    getPartitionQuotaPercent,
    getFileQuotaPercent,
    getParentQuotaPercent,
    parentSize,
    selectedPartition,
    setHoveredPartition,
    handleInspect,
    performDrillDown
  } = options

  const rendererRef = useRef<VoronoiRenderer | null>(null)

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return
    if (navigationLock && isFetching) return

    // Cleanup previous renderer
    if (rendererRef.current) {
      rendererRef.current.cleanup()
    }

    // Create new renderer
    const renderer = new VoronoiRenderer({
      svgRef,
      containerRef,
      tooltipRef,
      voronoiCacheRef,
      zoomRef,
      isFullscreen,
      getPartitionQuotaPercent,
      getFileQuotaPercent,
      getParentQuotaPercent,
      parentSize,
      selectedPartition,
      setHoveredPartition,
      handleInspect,
      performDrillDown
    })

    // Render
    renderer.render(data, effectivePath)

    // Store simulation
    simulationRef.current = renderer.getSimulation()
    rendererRef.current = renderer

    // Cleanup on unmount
    return () => {
      if (rendererRef.current) {
        rendererRef.current.cleanup()
        rendererRef.current = null
      }
    }
  }, [
    data,
    effectivePath,
    isFullscreen,
    performDrillDown,
    handleInspect,
    getPartitionQuotaPercent,
    getFileQuotaPercent,
    getParentQuotaPercent,
    parentSize,
    selectedPartition,
    navigationLock,
    isFetching,
    setHoveredPartition,
    zoomRef,
    svgRef,
    containerRef,
    tooltipRef,
    voronoiCacheRef,
    simulationRef
  ])
}
