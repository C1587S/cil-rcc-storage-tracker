import { useEffect, useRef, useState } from 'react'
import { type VoronoiNode } from '@/lib/voronoi-data-adapter'
import { type PartitionInfo, type VoronoiCacheEntry } from '@/lib/voronoi/utils/types'
import { VoronoiRenderer } from '@/lib/voronoi/rendering/VoronoiRenderer'

/**
 * Options for useVoronoiRenderer hook
 */
export interface UseVoronoiRendererOptions {
  data: VoronoiNode | undefined
  effectivePath: string
  isFullscreen: boolean
  isExpanded: boolean
  navigationLock: boolean
  isFetching: boolean
  svgRef: React.RefObject<SVGSVGElement>
  containerRef: React.RefObject<HTMLDivElement>
  tooltipRef: React.RefObject<HTMLDivElement>
  voronoiCacheRef: React.RefObject<Map<string, VoronoiCacheEntry>>
  zoomRef: React.MutableRefObject<any>
  simulationRef: React.MutableRefObject<d3.Simulation<any, undefined> | null>
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
 * React hook that manages voronoi rendering lifecycle.
 * Creates and manages VoronoiRenderer instances, handles cleanup,
 * and coordinates re-rendering when dependencies change.
 *
 * @param options - Rendering configuration and callbacks
 * @returns Object containing isRendering flag for loading states
 */
export function useVoronoiRenderer(options: UseVoronoiRendererOptions): { isRendering: boolean } {
  const {
    data,
    effectivePath,
    isFullscreen,
    isExpanded,
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
  const [isRendering, setIsRendering] = useState(false)

  useEffect(() => {
    console.log('[useVoronoiRenderer] useEffect triggered:', {
      hasData: !!data,
      effectivePath,
      isFullscreen,
      isExpanded,
      navigationLock,
      isFetching,
      hasSvgRef: !!svgRef.current,
      hasContainerRef: !!containerRef.current
    })

    if (!data || !svgRef.current || !containerRef.current) {
      console.log('[useVoronoiRenderer] Early return - missing data or refs')
      return
    }
    if (navigationLock && isFetching) {
      console.log('[useVoronoiRenderer] Early return - navigation locked and fetching')
      return
    }

    // Set rendering state
    setIsRendering(true)

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
      performDrillDown,
      onRenderComplete: () => setIsRendering(false)
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
    isExpanded,
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

  return { isRendering }
}
