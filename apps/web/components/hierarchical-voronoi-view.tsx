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
import { Maximize2, Minimize2, Focus, ArrowLeftRight, Minimize } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSnapshots } from '@/lib/api'
import {
  STORAGE_QUOTA_TB,
  FILE_COUNT_QUOTA,
} from '@/lib/voronoi/utils/constants'
import { type VoronoiCacheEntry } from '@/lib/voronoi/utils/types'
import { VoronoiHeader } from '@/components/voronoi/VoronoiHeader'
import { VoronoiLegend } from '@/components/voronoi/VoronoiLegend'
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
  const { selectedSnapshot, referencePath } = useAppStore()
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const simulationRef = useRef<d3.Simulation<any, undefined> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const voronoiCacheRef = useRef<Map<string, VoronoiCacheEntry>>(new Map())

  // Horizontal expansion state
  const [isExpanded, setIsExpanded] = useState(false)

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

  const viewRootSize = data?.size || 0
  const projectSize = viewRootSize
  const storageTB = projectSize / (1024 ** 4)
  const storageQuotaPercent = (storageTB / STORAGE_QUOTA_TB) * 100
  const parentSize = viewRootSize

  const getPartitionQuotaPercent = useCallback((size: number) => projectSize > 0 ? (size / projectSize) * 100 : 0, [projectSize])
  const getFileQuotaPercent = useCallback((fileCount: number) => (fileCount / FILE_COUNT_QUOTA) * 100, [])
  const getParentQuotaPercent = useCallback((size: number) => parentSize > 0 ? (size / parentSize) * 100 : 0, [parentSize])

  // --- RENDERING ---
  useVoronoiRenderer({
    data: data ?? undefined,
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

  return (
    <div ref={wrapperRef} className={cn("space-y-3 font-mono text-xs transition-all duration-300", isFullscreen && "fixed inset-0 z-50 bg-[#0a0e14] p-4", isExpanded && !isFullscreen && "mx-[-200px]")}>
      <div ref={tooltipRef} className="fixed pointer-events-none z-50 bg-black/90 border border-cyan-600 rounded px-2 py-1 hidden" />

      {/* HEADER */}
      <VoronoiHeader
        selectedSnapshot={selectedSnapshot}
        projectSize={projectSize}
        storageQuotaPercent={storageQuotaPercent}
        viewingPath={viewingPath}
        parentSize={parentSize}
      />

      {/* PANELS */}
      <VoronoiPartitionPanel
        activePartition={activePartition}
        selectedFileInPanel={selectedFileInPanel}
        onFileClick={handleFileClickInPanel}
      />

      {/* BREADCRUMB */}
      <VoronoiBreadcrumb
        breadcrumbParts={breadcrumbParts}
        canGoBack={canGoBack}
        isLocked={isLocked}
        onNavigateBack={navigateBack}
        onNavigateToBreadcrumb={navigateToBreadcrumb}
      />

      {/* VISUALIZER */}
      <div ref={containerRef} className={cn("relative border border-gray-800 bg-[#0a0e14] rounded-lg overflow-hidden", isLocked && "pointer-events-none")} style={{ height: isFullscreen ? 'calc(100vh - 280px)' : '550px' }}>
        <svg ref={svgRef} className={cn("w-full h-full cursor-crosshair", isLocked && "pointer-events-none")} />

        <div className="absolute bottom-3 right-3 flex gap-2">
          <Button size="icon" variant="outline" className="bg-black/80 border-gray-700 w-8 h-8 hover:bg-gray-800 hover:border-cyan-700" onClick={() => resetZoom(svgRef)} disabled={isLocked} title="Recenter View"><Focus className="w-4 h-4" /></Button>
          <Button size="icon" variant="outline" className="bg-black/80 border-gray-700 w-8 h-8 hover:bg-gray-800 hover:border-cyan-700" onClick={() => setIsExpanded(!isExpanded)} disabled={isLocked} title={isExpanded ? 'Return to Original Width' : 'Expand Horizontally'}>{isExpanded ? <Minimize className="w-4 h-4" /> : <ArrowLeftRight className="w-4 h-4" />}</Button>
          <Button size="icon" variant="outline" className="bg-black/80 border-gray-700 w-8 h-8 hover:bg-gray-800 hover:border-cyan-700" onClick={() => toggleFullscreen(wrapperRef)} title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>{isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</Button>
        </div>

        {error && <div className="absolute inset-0 flex items-center justify-center bg-black/80"><p className="text-red-500 font-bold">Failed to compute Voronoi: {error.toString()}</p></div>}

        {isLocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-cyan-950/50 border border-cyan-600 px-6 py-4 rounded-lg flex items-center gap-3 animate-pulse">
              <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <div className="text-cyan-400 font-bold">{navigationLock ? 'Navigating...' : 'Loading...'}</div>
            </div>
          </div>
        )}
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
}
