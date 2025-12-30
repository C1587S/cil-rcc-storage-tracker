'use client'

/**
 * Hierarchical Voronoi Treemap Visualization
 *
 * Production-ready visualization component with clean architecture:
 * - Custom hooks for data, navigation, selection, and zoom
 * - Class-based rendering layers (Background, Preview, Bubble, Label, Interaction)
 * - VoronoiComputer for computation with caching
 * - Separated concerns for maintainability and scalability
 */

import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Maximize2, Minimize2, Focus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSnapshots } from '@/lib/api'
import {
  STORAGE_QUOTA_TB,
  FILE_COUNT_QUOTA,
} from '@/lib/voronoi/utils/constants'
import { type VoronoiCacheEntry } from '@/lib/voronoi/utils/types'
import { VoronoiHeader } from '@/components/voronoi/VoronoiHeader'
import { VoronoiLegend } from '@/components/voronoi/VoronoiLegend'
import { VoronoiCategoryLegend } from '@/components/voronoi/VoronoiCategoryLegend'
import { VoronoiBubbleSizeLegend } from '@/components/voronoi/VoronoiBubbleSizeLegend'
import { VoronoiTrafficLightLegend } from '@/components/voronoi/VoronoiTrafficLightLegend'
import { VoronoiControlPanel } from '@/components/voronoi/VoronoiControlPanel'
import { VoronoiBreadcrumb } from '@/components/voronoi/VoronoiBreadcrumb'
import { VoronoiPartitionPanel } from '@/components/voronoi/VoronoiPartitionPanel'
import { useVoronoiData } from '@/lib/voronoi/hooks/useVoronoiData'
import { useVoronoiDataOnTheFly } from '@/lib/voronoi/hooks/useVoronoiDataOnTheFly'
import { useVoronoiNavigation } from '@/lib/voronoi/hooks/useVoronoiNavigation'
import { useVoronoiSelection } from '@/lib/voronoi/hooks/useVoronoiSelection'
import { useVoronoiZoom } from '@/lib/voronoi/hooks/useVoronoiZoom'
import { useVoronoiRenderer } from '@/lib/voronoi/hooks/useVoronoiRenderer'

// --- COMPONENT ---

export interface HierarchicalVoronoiViewProps {
  /**
   * Data loading mode:
   * - 'precomputed': Load from ClickHouse precomputed data (default, production)
   * - 'on-the-fly': Compute voronoi tree on-the-fly using buildVoronoiTree (legacy/debug)
   */
  mode?: 'precomputed' | 'on-the-fly'
}

export function HierarchicalVoronoiView({ mode = 'precomputed' }: HierarchicalVoronoiViewProps = {}) {
  const { selectedSnapshot, referencePath, highlightColor, theme } = useAppStore()
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const simulationRef = useRef<d3.Simulation<any, undefined> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const voronoiCacheRef = useRef<Map<string, VoronoiCacheEntry>>(new Map())
  

  const { data: snapshots } = useQuery({ queryKey: ['snapshots'], queryFn: getSnapshots })

  const basePath = referencePath || '/project/cil'

  // Custom hooks
  const {
    selectedPartition,
    hoveredPartition,
    selectedFileInPanel,
    setSelectedPartition,
    setHoveredPartition,
    setSelectedFileInPanel,
    handleInspect,
    handleFileClickInPanel,
  } = useVoronoiSelection()

  const {
    viewingPath,
    history,
    navigationLock,
    effectivePath,
    effectivePathRef,
    performDrillDown,
    navigateBack,
    navigateToBreadcrumb,
    unlockNavigation,
  } = useVoronoiNavigation({
    basePath,
    onNavigate: () => {
      setSelectedPartition(null)
      setHoveredPartition(null)
      setSelectedFileInPanel(null)
    },
  })

  const { isFullscreen, zoomRef, resetZoom, toggleFullscreen } = useVoronoiZoom()

  // Choose data loading strategy based on mode
  const precomputedResult = useVoronoiData({
    selectedSnapshot,
    effectivePath,
  })

  const onTheFlyResult = useVoronoiDataOnTheFly({
    selectedSnapshot,
    effectivePath,
  })

  // Select the appropriate result based on mode
  const { data, isLoading, isFetching, error } = mode === 'on-the-fly' ? onTheFlyResult : precomputedResult

  // Unlock when data arrives
  useEffect(() => {
    if (data && !isLoading && !isFetching) {
      unlockNavigation()
    }
  }, [data, isLoading, isFetching, unlockNavigation])

  // Current view size (changes with navigation)
  const viewRootSize = data?.size || 0
  const parentSize = viewRootSize

  // Global project size (always the root, doesn't change with navigation)
  const [globalRootSize, setGlobalRootSize] = useState(0)

  // Update global root size only when we're at the base path
  useEffect(() => {
    if (data && effectivePath === basePath) {
      setGlobalRootSize(data.size)
    }
  }, [data, effectivePath, basePath])

  const projectSize = globalRootSize || viewRootSize 
  const storageTB = projectSize / (1024 ** 4)
  const storageQuotaPercent = (storageTB / STORAGE_QUOTA_TB) * 100

  // Calculate percentage relative to 500 TB quota (not current view)
  const getPartitionQuotaPercent = useCallback((size: number) => {
    const sizeInTB = size / (1024 ** 4)
    return (sizeInTB / STORAGE_QUOTA_TB) * 100
  }, [])
  const getFileQuotaPercent = useCallback((fileCount: number) => (fileCount / FILE_COUNT_QUOTA) * 100, [])
  const getParentQuotaPercent = useCallback((size: number) => parentSize > 0 ? (size / parentSize) * 100 : 0, [parentSize])

  // --- RENDERING ---
  const { isRendering } = useVoronoiRenderer({
    data: data ?? undefined,
    effectivePath,
    isFullscreen,
    isExpanded: false,
    navigationLock,
    isFetching,
    highlightColor,
    theme,
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
  })

  // --- BREADCRUMB ---
  const breadcrumbParts = useMemo(() => {
    const parts: Array<{ name: string; path: string; isClickable: boolean }> = []

    const baseName = basePath.split('/').filter(Boolean).pop() || 'root'
    parts.push({ name: baseName, path: basePath, isClickable: effectivePath !== basePath })

    history.forEach((histPath) => {
      if (histPath !== basePath) {
        const name = histPath.split('/').filter(Boolean).pop() || histPath
        parts.push({ name, path: histPath, isClickable: histPath !== effectivePath })
      }
    })

    if (viewingPath && viewingPath !== basePath && !history.includes(viewingPath)) {
      const name = viewingPath.split('/').filter(Boolean).pop() || viewingPath
      parts.push({ name, path: viewingPath, isClickable: false })
    }

    return parts
  }, [basePath, history, viewingPath, effectivePath])

  const canGoBack = history.length > 0
  const activePartition = hoveredPartition || selectedPartition
  const isLocked = isLoading || isFetching || navigationLock

  // --- CONTENT RENDERER ---
  const renderContent = (isPortalMode: boolean) => (
    <div
      ref={wrapperRef}
      className={cn(
        // ESTILOS BASE - Adaptado al theme
        "space-y-3 font-mono text-xs flex flex-col",
        theme === 'dark' ? 'bg-[#0a0e14]' : 'bg-card',

        // MODO PANTALLA COMPLETA - expande verticalmente
        isFullscreen && "fixed inset-0 z-50 p-4 h-screen",

        // MODO EXPANDIDO (PORTAL)
        isPortalMode && cn(
          "w-full h-full p-6 rounded-xl border-2 shadow-2xl backdrop-blur-sm",
          theme === 'dark' ? 'border-cyan-800 shadow-black bg-[#0a0e14]/95' : 'border-primary/20 shadow-gray-400 bg-card/95'
        ),

        // Si NO es portal ni fullscreen (estado normal)
        !isPortalMode && !isFullscreen && "relative"
      )}
    >
      <div ref={tooltipRef} className="fixed pointer-events-none z-50 bg-black/90 border border-cyan-600 rounded px-2 py-1 hidden" />

      {/* HEADER */}
      <VoronoiHeader
        selectedSnapshot={selectedSnapshot}
        projectSize={projectSize}
        storageQuotaPercent={storageQuotaPercent}
        viewingPath={viewingPath}
        parentSize={parentSize}
        isFullscreen={isFullscreen}
      />

      {/* PANELS */}
      <VoronoiPartitionPanel
        activePartition={activePartition}
        selectedFileInPanel={selectedFileInPanel}
        onFileClick={handleFileClickInPanel}
        isExpanded={false}
        isFullscreen={isFullscreen}
      />

      {/* BREADCRUMB */}
      <VoronoiBreadcrumb
        breadcrumbParts={breadcrumbParts}
        canGoBack={canGoBack}
        isLocked={isLocked}
        currentData={data}
        onNavigateBack={navigateBack}
        onNavigateToBreadcrumb={navigateToBreadcrumb}
        onDrillDown={performDrillDown}
      />

      {/* VISUALIZER CONTAINER */}
      <div
        ref={containerRef}
        className={cn(
          "relative border rounded-lg overflow-hidden",
          theme === 'dark' ? 'border-gray-800 bg-[#0a0e14]' : 'border-border bg-card',
          isLocked && "pointer-events-none",
          // En fullscreen, flex-1 toma todo el espacio disponible verticalmente
          isFullscreen ? "flex-1" : ""
        )}
        style={{
          // Altura fija en modo normal, auto en fullscreen para que flex-1 funcione
          height: isFullscreen ? 'auto' : '550px',
          minHeight: isFullscreen ? '0' : '550px'
        }}
      >
        <svg
          ref={svgRef}
          className={cn("w-full h-full cursor-crosshair", isLocked && "pointer-events-none")}
          style={{
            background: theme === 'dark' ? '#0a0e14' : '#eceff4'
          }}
        />

        <div className="absolute bottom-3 right-3 flex gap-2">
          <Button
            size="icon"
            variant="outline"
            className={cn(
              "w-8 h-8",
              theme === 'dark'
                ? 'bg-black/80 border-gray-700 hover:bg-gray-800 hover:border-cyan-700'
                : 'bg-white/90 border-gray-300 hover:bg-gray-50 hover:border-primary'
            )}
            onClick={() => resetZoom(svgRef)}
            disabled={isLocked}
            title="Recenter View"
          >
            <Focus className="w-4 h-4" />
          </Button>

          {!isFullscreen && (
            <Button
              size="icon"
              variant="outline"
              className={cn(
                "w-8 h-8",
                theme === 'dark'
                  ? 'bg-black/80 border-gray-700 hover:bg-gray-800 hover:border-cyan-700'
                  : 'bg-white/90 border-gray-300 hover:bg-gray-50 hover:border-primary'
              )}
              onClick={() => {
                console.log('[HierarchicalVoronoiView] Fullscreen button clicked')
                toggleFullscreen(wrapperRef)
              }}
              title="Fullscreen"
            >
              <Maximize2 className="w-4 h-4" />
            </Button>
          )}
          {isFullscreen && (
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "gap-1.5 h-8",
                theme === 'dark'
                  ? 'bg-black/80 border-gray-700 hover:bg-gray-800 hover:border-cyan-700'
                  : 'bg-white/90 border-gray-300 hover:bg-gray-50 hover:border-primary'
              )}
              onClick={() => {
                console.log('[HierarchicalVoronoiView] Exit fullscreen clicked')
                toggleFullscreen(wrapperRef)
              }}
            >
              <Minimize2 className="w-3 h-3" /> <span className="text-xs">Exit (ESC)</span>
            </Button>
          )}
        </div>

        {error && <div className="absolute inset-0 flex items-center justify-center bg-black/80"><p className="text-red-500 font-bold">Failed to compute Voronoi: {error.toString()}</p></div>}

        {isLocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-cyan-950/50 border border-cyan-600 px-6 py-4 rounded-lg flex items-center gap-3 animate-pulse">
              <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <div className="text-cyan-400 font-bold">{navigationLock ? 'Loading...' : 'Loading...'}</div>
            </div>
          </div>
        )}

        {!isLocked && isRendering && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none">
            <div className="bg-cyan-950/50 border border-cyan-600 px-6 py-4 rounded-lg flex items-center gap-3 animate-pulse">
              <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <div className="text-cyan-400 font-bold">Resizing...</div>
            </div>
          </div>
        )}
      </div>

      {/* LEGENDS - Layout: File Categories izquierda (2 filas), Bubble+Quota derecha (vertical) */}
      <div className="grid grid-cols-[1fr_auto] gap-3">
        {/* Columna izquierda: File Categories con 2 filas de 5 elementos */}
        <VoronoiCategoryLegend isExpanded={false} isFullscreen={isFullscreen} />

        {/* Columna derecha: Bubble Size arriba, Quota abajo (ambos en una sola fila) */}
        <div className="flex flex-col gap-3">
          <VoronoiBubbleSizeLegend isExpanded={false} isFullscreen={isFullscreen} />
          <VoronoiTrafficLightLegend isExpanded={false} isFullscreen={isFullscreen} />
        </div>
      </div>

      {/* CONTROLS */}
      <VoronoiControlPanel
        cacheSize={voronoiCacheRef.current.size}
        effectivePath={effectivePath}
        historyLength={history.length}
        navigationLock={navigationLock}
      />

      {/* LEGEND */}
      <VoronoiLegend />
    </div>
  )

  return renderContent(false)
}