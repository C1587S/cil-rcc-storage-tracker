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
import { Maximize2, Minimize2, Focus, BarChart2, Play, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSnapshots } from '@/lib/api'
import {
  STORAGE_QUOTA_TB,
  FILE_COUNT_QUOTA,
} from '@/lib/voronoi/utils/constants'
import { type VoronoiCacheEntry, type PartitionInfo } from '@/lib/voronoi/utils/types'
import { VoronoiHeader } from '@/components/voronoi/VoronoiHeader'
import { VoronoiLegend } from '@/components/voronoi/VoronoiLegend'
import { VoronoiCategoryLegend } from '@/components/voronoi/VoronoiCategoryLegend'
import { VoronoiBubbleSizeLegend } from '@/components/voronoi/VoronoiBubbleSizeLegend'
import { VoronoiTrafficLightLegend } from '@/components/voronoi/VoronoiTrafficLightLegend'
import { VoronoiControlPanel } from '@/components/voronoi/VoronoiControlPanel'
import { VoronoiBreadcrumb } from '@/components/voronoi/VoronoiBreadcrumb'
import { VoronoiPartitionPanel } from '@/components/voronoi/VoronoiPartitionPanel'
import { ThemeToggle } from '@/components/ThemeToggle'
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
  const [hasRun, setHasRun] = useState(false)

  // Reset gate when snapshot changes
  useEffect(() => {
    setHasRun(false)
  }, [selectedSnapshot])

  // Scroll visualizer into view when loading starts
  useEffect(() => {
    if (hasRun && containerRef.current) {
      setTimeout(() => {
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    }
  }, [hasRun])
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

  const { isFullscreen, isTransitioning, zoomRef, resetZoom, toggleFullscreen } = useVoronoiZoom()

  // Choose data loading strategy based on mode
  const precomputedResult = useVoronoiData({
    selectedSnapshot,
    effectivePath,
    enabled: hasRun,
  })

  const onTheFlyResult = useVoronoiDataOnTheFly({
    selectedSnapshot,
    effectivePath,
    enabled: hasRun,
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

  // Create PartitionInfo for current directory being viewed
  const currentPartitionInfo: PartitionInfo | null = useMemo(() => {
    if (!data) return null
    return {
      name: data.name,
      path: data.path,
      size: data.size,
      file_count: data.file_count || 0,
      isDirectory: data.isDirectory,
      isSynthetic: data.isSynthetic || false,
      quotaPercent: getPartitionQuotaPercent(data.size),
      fileQuotaPercent: getFileQuotaPercent(data.file_count || 0),
      parentSize: parentSize,
      parentQuotaPercent: getParentQuotaPercent(data.size),
      depth: data.depth || 0,
      originalFiles: data.originalFiles,
      children: data.children
    }
  }, [data, getPartitionQuotaPercent, getFileQuotaPercent, getParentQuotaPercent, parentSize])

  const activePartition = hoveredPartition || selectedPartition || currentPartitionInfo
  const isLocked = isLoading || isFetching || navigationLock

  // --- CONTENT RENDERER ---
  const renderContent = (isPortalMode: boolean) => (
    <div
      ref={wrapperRef}
      className={cn(
        // ESTILOS BASE - Adaptado al theme
        "space-y-3 font-mono text-xs flex flex-col",
        theme === 'dark' ? 'bg-[#1e1e1e]' : 'bg-background',

        // MODO PANTALLA COMPLETA - expande verticalmente
        isFullscreen && "fixed inset-0 z-50 p-4 h-screen",

        // MODO EXPANDIDO (PORTAL)
        isPortalMode && cn(
          "w-full h-full p-6 rounded-xl border-2 shadow-2xl backdrop-blur-sm",
          theme === 'dark' ? 'border-border shadow-black bg-[#1e1e1e]/95' : 'border-primary/20 shadow-gray-400 bg-card/95'
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

      {/* PANELS — only after visualization has been run */}
      {hasRun && (
        <VoronoiPartitionPanel
          activePartition={activePartition}
          selectedFileInPanel={selectedFileInPanel}
          onFileClick={handleFileClickInPanel}
          isExpanded={false}
          isFullscreen={isFullscreen}
          isPartitionFixed={selectedPartition !== null}
        />
      )}

      {/* BREADCRUMB — only after visualization has been run */}
      {hasRun && (
        <VoronoiBreadcrumb
          breadcrumbParts={breadcrumbParts}
          canGoBack={canGoBack}
          isLocked={isLocked}
          currentData={data}
          onNavigateBack={navigateBack}
          onNavigateToBreadcrumb={navigateToBreadcrumb}
          onDrillDown={performDrillDown}
        />
      )}

      {/* VISUALIZER CONTAINER */}
      <div
        ref={containerRef}
        className={cn(
          "relative border rounded-lg overflow-hidden",
          theme === 'dark' ? 'border-border bg-[#1e1e1e]' : 'border-border bg-card',
          isLocked && "pointer-events-none",
          // En fullscreen, flex-1 toma todo el espacio disponible verticalmente
          isFullscreen ? "flex-1" : ""
        )}
        style={{
          // Altura fija en modo normal, auto en fullscreen para que flex-1 funcione
          height: isFullscreen ? 'auto' : undefined,
          minHeight: isFullscreen ? '0' : '300px'
        }}
      >
        {/* SVG canvas — always mounted, hidden behind gate when not running */}
        <svg
          ref={svgRef}
          className={cn(
            "w-full h-full cursor-crosshair transition-opacity duration-500",
            !hasRun && "opacity-0",
            isLocked && "pointer-events-none"
          )}
          style={{
            background: theme === 'dark' ? '#1e1e1e' : '#f6f5f4'
          }}
        />

        {/* Gate UI — fades out when hasRun becomes true */}
        <div className={cn(
          "absolute inset-0 flex justify-center pt-5 px-6 transition-all duration-500",
          hasRun ? "opacity-0 pointer-events-none" : "opacity-100"
        )}>
          <div className={cn(
            "flex items-center gap-5 px-6 py-3 rounded-xl w-full max-w-[720px] h-fit",
            theme === 'dark'
              ? 'bg-card border border-white/[0.06] shadow-lg shadow-black/40'
              : 'bg-card border border-black/[0.06] shadow-md shadow-black/[0.06]'
          )}>
            {/* Icon */}
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10">
              <BarChart2 className="w-4 h-4 text-primary" strokeWidth={1.5} />
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground/60 mr-2">Storage Map</span>
              <span className="text-[11px] text-muted-foreground/40">
                Area-proportional visualization of storage usage. Identifies hotspots. May take 20-60 s.
              </span>
            </div>

            {/* Action */}
            <div className="flex-shrink-0">
              {selectedSnapshot ? (
                <button
                  onClick={() => setHasRun(true)}
                  title="Run visualization"
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200",
                    theme === 'dark'
                      ? 'bg-primary/15 hover:bg-primary/30 text-primary border border-primary/20 hover:border-primary/50'
                      : 'bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25 hover:border-primary/50'
                  )}
                >
                  <Play className="w-3.5 h-3.5 ml-0.5" strokeWidth={2} />
                </button>
              ) : (
                <p className="text-[10px] text-muted-foreground/30 whitespace-nowrap">
                  Select a snapshot
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Loading overlays — only when running */}
        {hasRun && (
          <>
            {error && <div className="absolute inset-0 flex items-center justify-center bg-black/80"><p className="text-red-500 font-bold">Failed to compute Voronoi: {error.toString()}</p></div>}

            <div className={cn(
              "absolute inset-0 flex items-center justify-center transition-all duration-700 ease-out",
              isLocked
                ? "opacity-100 bg-background/50 backdrop-blur-sm"
                : "opacity-0 pointer-events-none bg-transparent"
            )}>
              <div className={cn(
                "bg-card border border-border px-5 py-3 rounded-lg flex items-center gap-3 shadow-md transition-all duration-500",
                isLocked ? "scale-100 opacity-100" : "scale-95 opacity-0"
              )}>
                <div className="loader-morph" />
                <div className="text-muted-foreground text-[10px]">Computing visualization. This can take 60 seconds or more for deep trees.</div>
              </div>
            </div>

            <div className={cn(
              "absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-500 ease-out",
              !isLocked && isRendering
                ? "opacity-100 bg-background/30 backdrop-blur-[2px]"
                : "opacity-0 bg-transparent"
            )}>
              <div className={cn(
                "bg-card border border-border px-5 py-3 rounded-lg flex items-center gap-3 shadow-md transition-all duration-400",
                !isLocked && isRendering ? "scale-100 opacity-100" : "scale-95 opacity-0"
              )}>
                <div className="loader-morph" />
                <div className="text-muted-foreground text-[10px]">Rendering...</div>
              </div>
            </div>

            <div className={cn(
              "absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-400 ease-out",
              isTransitioning && !isLocked && !isRendering
                ? "opacity-100 bg-background/15 backdrop-blur-[1px]"
                : "opacity-0 bg-transparent"
            )}>
              <div className={cn(
                "bg-card/80 border border-border/50 px-5 py-3 rounded-lg flex items-center gap-3 shadow-sm transition-all duration-300",
                isTransitioning && !isLocked && !isRendering ? "scale-100 opacity-100" : "scale-95 opacity-0"
              )}>
                <div className="loader-morph" />
                <div className="text-muted-foreground/60 text-[10px]">Navigating...</div>
              </div>
            </div>
          </>
        )}

        <div className="absolute bottom-3 right-3 flex gap-2">
          {isFullscreen && <ThemeToggle />}

          {hasRun && (
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
          )}

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
      </div>

      {/* LEGENDS - Stacked on mobile, side-by-side on lg+ */}
      <div className="flex flex-col lg:grid lg:grid-cols-[1fr_auto] gap-3">
        {/* Bubble Size + Traffic Light — shown first on mobile, right column on desktop */}
        <div className="flex flex-row gap-3 order-1 lg:order-2">
          <VoronoiBubbleSizeLegend isExpanded={false} isFullscreen={isFullscreen} />
          <VoronoiTrafficLightLegend isExpanded={false} isFullscreen={isFullscreen} />
        </div>

        {/* File Categories — below on mobile, left column on desktop */}
        <VoronoiCategoryLegend isExpanded={false} isFullscreen={isFullscreen} />
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

  return (
    <>
      {/* Portrait mobile: suggest rotating device */}
      <div className="flex sm:hidden flex-col items-center justify-center gap-4 py-16 text-center px-8">
        <RotateCcw className="w-10 h-10 text-muted-foreground/40" />
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-1">Landscape mode recommended</p>
          <p className="text-xs text-muted-foreground/60">Rotate your device for the best Voronoi visualization experience</p>
        </div>
      </div>
      {/* Landscape / desktop: show voronoi */}
      <div className="hidden sm:block">
        {renderContent(false)}
      </div>
    </>
  )
}