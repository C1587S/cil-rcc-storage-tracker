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
  highlightColor: string
  theme: 'dark' | 'light'
  // 🔥 NUEVO: Trigger explícito para forzar re-render desde el padre
  // Esto es vital para sincronizar con transiciones de Portals/Tabs
  layoutTrigger?: number

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
    highlightColor,
    theme,
    layoutTrigger = 0, // Default a 0
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
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 })

  // 1. CALLBACK STABILITY
  // Store callbacks in refs to prevent infinite re-renders.
  const callbacksRef = useRef({
    getPartitionQuotaPercent,
    getFileQuotaPercent,
    getParentQuotaPercent,
    setHoveredPartition,
    handleInspect,
    performDrillDown
  })

  // Update refs on every render
  useEffect(() => {
    callbacksRef.current = {
      getPartitionQuotaPercent,
      getFileQuotaPercent,
      getParentQuotaPercent,
      setHoveredPartition,
      handleInspect,
      performDrillDown
    }
  })

  // 2. DIMENSION OBSERVING (Interno del Hook)
  // Mantiene sincronizado el estado interno de dimensiones con el DOM real.
  useEffect(() => {
    if (!containerRef.current) return

    let animationFrameId: number;

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;

      const entry = entries[0];
      const { width, height } = entry.contentRect;

      cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(() => {
        setContainerDimensions(prev => {
          // Solo actualizamos si el cambio es significativo (> 1px) para evitar loops
          if (Math.abs(prev.width - width) > 1 || Math.abs(prev.height - height) > 1) {
            return { width, height }
          }
          return prev
        })
      });
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      cancelAnimationFrame(animationFrameId)
    }
  }, [containerRef, isExpanded, isFullscreen]) // Re-conectar si cambia el modo de vista

  // 3. MAIN RENDER EFFECT
  // This is the brain that decides when to render
  useEffect(() => {
    // 3a. Safety Checks
    // Note: Even if containerDimensions is 0, if layoutTrigger changes, we want to try reading the ref
    if (!data || !svgRef.current || !containerRef.current) {
      setIsRendering(false)
      return
    }
    
    // Prevent rendering if locked
    if (navigationLock && isFetching) {
      return
    }

    // Read dimensions directly from ref if state hasn't updated yet (race condition mitigation)
    const domWidth = containerRef.current.clientWidth
    const domHeight = containerRef.current.clientHeight

    // If real DOM is 0 (e.g. before Portal mount), abort
    if (domWidth === 0 || domHeight === 0) return

    console.log('[RENDER] Syncing Voronoi:', {
      trigger: layoutTrigger,
      domSize: `${domWidth}x${domHeight}`,
      path: effectivePath
    })

    setIsRendering(true)

    // 3b. Cleanup previous instance
    if (rendererRef.current) {
      rendererRef.current.cleanup()
    }

    // 3c. Instantiate Renderer
    const renderer = new VoronoiRenderer({
      svgRef,
      containerRef,
      tooltipRef,
      voronoiCacheRef,
      zoomRef,
      isFullscreen,
      highlightColor,
      theme,
      parentSize,
      selectedPartition,
      getPartitionQuotaPercent: (s) => callbacksRef.current.getPartitionQuotaPercent(s),
      getFileQuotaPercent: (c) => callbacksRef.current.getFileQuotaPercent(c),
      getParentQuotaPercent: (s) => callbacksRef.current.getParentQuotaPercent(s),
      setHoveredPartition: (i) => callbacksRef.current.setHoveredPartition(i),
      handleInspect: (i) => callbacksRef.current.handleInspect(i),
      performDrillDown: (p) => callbacksRef.current.performDrillDown(p),
      onRenderComplete: () => setIsRendering(false)
    })

    // 3d. Execute Render
    renderer.render(data, effectivePath)

    // 3e. Store References
    simulationRef.current = renderer.getSimulation()
    rendererRef.current = renderer

    // 3f. Cleanup on unmount/re-run
    return () => {
      if (rendererRef.current) {
        rendererRef.current.cleanup()
        rendererRef.current = null
      }
    }
  }, [
    // Dependencias Críticas
    data,
    effectivePath,
    layoutTrigger, // <--- AL CAMBIAR ESTO, FORZAMOS RENDER INMEDIATO
    highlightColor, // Re-render when highlight color changes

    // Dimensiones detectadas por el Observer
    containerDimensions.width,
    containerDimensions.height,

    // UI States
    isFullscreen,
    isExpanded,
    parentSize,
    selectedPartition,
    navigationLock,
    isFetching,
    
    // Refs
    svgRef,
    containerRef,
    tooltipRef,
    voronoiCacheRef,
    zoomRef,
    simulationRef
  ])

  return { isRendering }
}