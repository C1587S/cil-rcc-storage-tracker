'use client'

/**
 * Treemap / Sunburst composition view (ECharts).
 *
 * Canvas-rendered alternative to the Voronoi: shows directory composition
 * as rectangles (treemap) or rings (sunburst), weighted by storage size or
 * file count. Reuses the same precomputed voronoi tree data as the Voronoi
 * view, so no extra backend work is required.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import * as echarts from 'echarts/core'
import { TreemapChart, SunburstChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { LayoutGrid, PieChart, HardDrive, Files } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { useVoronoiData } from '@/lib/voronoi/hooks/useVoronoiData'
import { GridLoader } from '@/components/ui/grid-loader'
import { VoronoiBreadcrumb } from '@/components/voronoi/VoronoiBreadcrumb'
import { VoronoiPartitionPanel } from '@/components/voronoi/VoronoiPartitionPanel'
import { type PartitionInfo } from '@/lib/voronoi/utils/types'
import { STORAGE_QUOTA_TB, FILE_COUNT_QUOTA } from '@/lib/voronoi/utils/constants'
import { formatBytes } from '@/lib/utils/formatters'
import { getSizeFillColor } from '@/lib/utils/icon-helpers'
import { cn } from '@/lib/utils'

echarts.use([TreemapChart, SunburstChart, TooltipComponent, CanvasRenderer])

type ChartKind = 'treemap' | 'sunburst'
type WeightMode = 'size' | 'files'

interface EChartsNode {
  name: string
  value: number
  path: string
  bytes: number
  fileCount: number
  directFiles: number
  directDirs: number
  isDirectory: boolean
  children?: EChartsNode[]
  raw?: any
}

// File-count severity: same visual language as size severity, applied to
// the number of files in the subtree.
function getFileCountFillColor(files: number): string {
  if (files > 1_000_000) return '#ef4444'  // red    (>1M files)
  if (files > 100_000) return '#fb923c'    // orange (100K-1M)
  if (files > 10_000) return '#facc15'     // yellow (10K-100K)
  if (files > 0) return '#4ade80'          // green  (<10K)
  return '#9ca3af'
}

function compactCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

function toEChartsTree(
  node: any, mode: WeightMode, depthLimit = 2, depth = 0,
  rootWeight = 0, pruneFrac = 0,
): EChartsNode {
  const bytes = node.size || 0
  const fileCount = node.file_count || node.originalFiles?.length || 0
  const value = mode === 'files' ? Math.max(fileCount, 1) : Math.max(bytes, 1)
  const rw = depth === 0 ? value : rootWeight

  const childDirs = (node.children || []).filter((c: any) => c.isDirectory)
  // Sunburst layering: branches below pruneFrac of the root stop expanding,
  // so only heavy subtrees reach the outer rings (the "pie grows if deeper"
  // look) instead of every ring closing into a full circle.
  const insignificant = pruneFrac > 0 && depth > 0 && value < rw * pruneFrac
  const children = depth < depthLimit && !insignificant
    ? childDirs.map((c: any) => toEChartsTree(c, mode, depthLimit, depth + 1, rw, pruneFrac))
    : undefined

  return {
    name: node.name,
    value,
    path: node.path,
    bytes,
    fileCount,
    directFiles: node.originalFiles?.length ?? 0,
    directDirs: childDirs.length,
    isDirectory: true,
    children: children && children.length > 0 ? children : undefined,
    raw: node,
    // Dual encoding: AREA carries the selected metric, COLOR carries the
    // complementary one (area=size -> color=file count, area=files -> color=size).
    // Dotted decal additionally marks file-dense cells.
    itemStyle: {
      color: mode === 'size' ? getFileCountFillColor(fileCount) : getSizeFillColor(bytes),
      ...(fileCount > 50000 && bytes > 0 && fileCount / (bytes / 1e9) > 1000 ? {
        decal: {
          symbol: 'circle',
          symbolSize: 0.6,
          color: 'rgba(0,0,0,0.25)',
          dashArrayX: [1, 0],
          dashArrayY: [4, 6],
        }
      } : {}),
    },
  }
}

export function TreemapView() {
  const { selectedSnapshot, referencePath, theme } = useAppStore()
  const basePath = referencePath || '/project/cil'

  const [visible, setVisible] = useState(false)
  const [chartKind, setChartKind] = useState<ChartKind>('treemap')
  const [weightMode, setWeightMode] = useState<WeightMode>('size')
  const [depthLimit, setDepthLimit] = useState(2)
  const [viewPath, setViewPath] = useState(basePath)
  const [pathStack, setPathStack] = useState<string[]>([])
  // Hovered-node info shown in the sunburst center (defaults to the root)
  const [hoverInfo, setHoverInfo] = useState<{ name: string; bytes: number; fileCount: number; pct: number } | null>(null)
  // Partition Info panel (shared with the Voronoi view)
  const [activePartition, setActivePartition] = useState<PartitionInfo | null>(null)
  const [isPartitionFixed, setIsPartitionFixed] = useState(false)

  const toPartitionInfo = useCallback((d: EChartsNode): PartitionInfo => ({
    name: d.name,
    path: d.path,
    size: d.bytes || 0,
    file_count: d.fileCount || 0,
    isDirectory: true,
    isSynthetic: false,
    quotaPercent: ((d.bytes || 0) / (1024 ** 4)) / STORAGE_QUOTA_TB * 100,
    fileQuotaPercent: (d.fileCount || 0) / FILE_COUNT_QUOTA * 100,
    depth: 0,
    originalFiles: d.raw?.originalFiles,
    children: d.raw?.children?.filter((c: any) => c.isDirectory),
  }), [])

  const wrapperRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)

  // Follow reference path changes from the store
  useEffect(() => {
    setViewPath(basePath)
    setPathStack([])
  }, [basePath, selectedSnapshot])

  // Fetch only when the tab is actually visible (tab panels stay mounted)
  useEffect(() => {
    if (visible) return
    const el = wrapperRef.current
    if (!el) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setVisible(true)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  // Sunburst renders one level deeper than the treemap: rings are cheap and
  // the extra depth is what produces the layered silhouette.
  const effectiveDepth = chartKind === 'sunburst' ? depthLimit + 1 : depthLimit

  const { data, isLoading, isFetching, error } = useVoronoiData({
    selectedSnapshot,
    effectivePath: viewPath,
    enabled: visible && !!selectedSnapshot,
    maxDepth: effectiveDepth,
    // Server-side pruning keeps deep fetches small; 0.05% of the root is
    // already a sub-degree sliver in either chart.
    minShare: 0.0005,
    // Full direct-file listings are megabytes per dir; the panel only needs
    // the biggest ones.
    filesLimit: 100,
  })

  const chartData = useMemo(() => {
    if (!data) return null
    return chartKind === 'sunburst'
      ? toEChartsTree(data, weightMode, effectiveDepth, 0, 0, 0.01)
      : toEChartsTree(data, weightMode, depthLimit)
  }, [data, weightMode, depthLimit, effectiveDepth, chartKind])

  const isBusy = isLoading || isFetching

  const drillDown = useCallback((path: string) => {
    setPathStack(prev => [...prev, viewPath])
    setViewPath(path)
  }, [viewPath])

  const goBack = useCallback(() => {
    setPathStack(prev => {
      if (prev.length === 0) return prev
      const next = [...prev]
      setViewPath(next.pop()!)
      return next
    })
  }, [])

  const jumpTo = useCallback((path: string) => {
    setViewPath(path)
    // Rebuild the stack as the chain of ancestors between basePath and path
    if (path === basePath) { setPathStack([]); return }
    const rel = path.startsWith(basePath + '/') ? path.slice(basePath.length + 1) : ''
    const stack = [basePath]
    let acc = basePath
    for (const seg of rel.split('/').slice(0, -1)) {
      acc = `${acc}/${seg}`
      stack.push(acc)
    }
    setPathStack(stack)
  }, [basePath])

  const breadcrumbParts = useMemo(() => {
    const parts: Array<{ name: string; path: string; isClickable: boolean }> = []
    const baseName = basePath.split('/').filter(Boolean).pop() || 'root'
    parts.push({ name: baseName, path: basePath, isClickable: viewPath !== basePath })
    if (viewPath !== basePath && viewPath.startsWith(basePath + '/')) {
      const rel = viewPath.slice(basePath.length + 1)
      let acc = basePath
      const segs = rel.split('/')
      segs.forEach((seg, i) => {
        acc = `${acc}/${seg}`
        parts.push({ name: seg, path: acc, isClickable: i < segs.length - 1 })
      })
    }
    return parts
  }, [basePath, viewPath])

  // Chart lifecycle
  useEffect(() => {
    if (!chartRef.current || !visible) return
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current)
    }
    const chart = chartInstance.current

    const onResize = () => chart.resize()
    const ro = new ResizeObserver(onResize)
    ro.observe(chartRef.current)
    return () => { ro.disconnect() }
  }, [visible])

  useEffect(() => () => {
    chartInstance.current?.dispose()
    chartInstance.current = null
  }, [])

  // Render options
  useEffect(() => {
    const chart = chartInstance.current
    if (!chart || !chartData) return

    const isDark = theme === 'dark'
    const textColor = isDark ? '#deddda' : '#3d3846'
    const borderColor = isDark ? '#241f31' : '#ffffff'

    const series = chartKind === 'treemap'
      ? {
          id: 'composition',
          type: 'treemap' as const,
          data: chartData.children || [chartData],
          left: 0, top: 0, right: 0, bottom: 0,
          nodeClick: false as const,
          roam: false,
          breadcrumb: { show: false },
          labelLayout: { hideOverlap: true },
          label: {
            show: true,
            formatter: (p: any) => {
              const d = p.data as EChartsNode | undefined
              if (!d || !d.name) return ''
              // Always show BOTH metrics: area encodes the selected one,
              // the label keeps the other visible.
              return `${d.name}\n${formatBytes(d.bytes || 0)} | ${compactCount(d.fileCount || 0)} files`
            },
            fontSize: 11,
            fontFamily: "'Courier New', monospace",
            color: '#1a1a1a',
            overflow: 'truncate' as const,
          },
          upperLabel: {
            show: true,
            height: 22,
            fontSize: 11,
            fontFamily: "'Courier New', monospace",
            color: '#1a1a1a',
            backgroundColor: 'transparent',
          },
          itemStyle: {
            borderColor: borderColor,
            borderWidth: 1,
            gapWidth: 2,
          },
          // Node colors come from per-node itemStyle (size severity);
          // levels only fade deeper cells slightly for hierarchy depth cues.
          levels: [
            { itemStyle: { borderWidth: 0, gapWidth: 3, colorAlpha: [0.85, 0.85] } },
            { itemStyle: { borderWidth: 2, gapWidth: 2, colorAlpha: [0.7, 0.7] } },
            { itemStyle: { borderWidth: 1, gapWidth: 1, colorAlpha: [0.55, 0.55] } },
            { itemStyle: { borderWidth: 1, gapWidth: 1, colorAlpha: [0.45, 0.45] } },
          ],
          universalTransition: true,
          animationDurationUpdate: 1000,
        }
      : {
          id: 'composition',
          type: 'sunburst' as const,
          data: chartData.children || [chartData],
          nodeClick: false as const,
          sort: 'desc' as const,
          radius: ['15%', '95%'],
          label: { show: false },
          universalTransition: true,
          animationDurationUpdate: 1000,
          itemStyle: {
            borderColor: borderColor,
            borderWidth: 1.5,
          },
          // Fade deeper rings so depth reads as layered bands, not one disc
          levels: [
            {},
            ...Array.from({ length: effectiveDepth + 1 }, (_, i) => ({
              itemStyle: { opacity: Math.max(0.45, 0.95 - i * 0.12) },
            })),
          ],
          center: ['50%', '50%'],
        }

    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: { show: false },
      series: [series],
    }, { replaceMerge: ['series'] })

    // Click drills into the clicked directory (fetches its subtree)
    chart.off('click')
    chart.on('click', (params: any) => {
      const d = params.data as EChartsNode | undefined
      if (d?.path && d.path !== viewPath) {
        drillDown(d.path)
      }
    })

    // Hover feeds the sunburst center info
    const rootPrimary = weightMode === 'files'
      ? Math.max(chartData.fileCount, 1)
      : Math.max(chartData.bytes, 1)
    chart.off('mouseover')
    chart.on('mouseover', (params: any) => {
      const d = params.data as EChartsNode | undefined
      if (!d || !d.name) return
      const primary = weightMode === 'files' ? (d.fileCount || 0) : (d.bytes || 0)
      setHoverInfo({
        name: d.name,
        bytes: d.bytes || 0,
        fileCount: d.fileCount || 0,
        pct: (primary / rootPrimary) * 100,
      })
      if (!isPartitionFixed) setActivePartition(toPartitionInfo(d))
    })
    chart.off('globalout')
    chart.on('globalout', () => setHoverInfo(null))
    chart.off('contextmenu')
    chart.on('contextmenu', (params: any) => {
      params.event?.event?.preventDefault?.()
      const d = params.data as EChartsNode | undefined
      if (!d || !d.name) return
      setActivePartition(toPartitionInfo(d))
      setIsPartitionFixed(true)
    })
  }, [chartData, chartKind, weightMode, depthLimit, theme, viewPath, drillDown, isPartitionFixed, toPartitionInfo])

  return (
    <div ref={wrapperRef} className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            className={cn(
              'px-3 h-8 flex items-center gap-1.5 text-xs transition-colors',
              chartKind === 'treemap' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setChartKind('treemap')}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Treemap
          </button>
          <button
            className={cn(
              'px-3 h-8 flex items-center gap-1.5 text-xs transition-colors',
              chartKind === 'sunburst' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setChartKind('sunburst')}
          >
            <PieChart className="w-3.5 h-3.5" /> Sunburst
          </button>
        </div>

        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            className={cn(
              'px-3 h-8 flex items-center gap-1.5 text-xs transition-colors',
              weightMode === 'size' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setWeightMode('size')}
            title="Area proportional to storage size"
          >
            <HardDrive className="w-3.5 h-3.5" /> Size
          </button>
          <button
            className={cn(
              'px-3 h-8 flex items-center gap-1.5 text-xs transition-colors',
              weightMode === 'files' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setWeightMode('files')}
            title="Area proportional to number of files"
          >
            <Files className="w-3.5 h-3.5" /> File count
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-border overflow-hidden">
          <span className="px-2 text-[10px] text-muted-foreground uppercase">Depth</span>
          {[2, 3, 4].map(d => (
            <button
              key={d}
              className={cn(
                'w-7 h-8 text-xs transition-colors',
                depthLimit === d ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setDepthLimit(d)}
              title={`Show ${d} levels below the current root`}
            >
              {d}
            </button>
          ))}
        </div>

        <span className="inline-flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>
            Area = {weightMode === 'size' ? 'size' : 'file count'} · Color = {weightMode === 'size' ? 'file count' : 'size'}:
          </span>
          {(weightMode === 'size'
            ? [
                { c: '#4ade80', l: '<10K files' },
                { c: '#facc15', l: '10K–100K' },
                { c: '#fb923c', l: '100K–1M' },
                { c: '#ef4444', l: '>1M' },
              ]
            : [
                { c: '#4ade80', l: '<10 GB' },
                { c: '#facc15', l: '10–20 GB' },
                { c: '#fb923c', l: '20–50 GB' },
                { c: '#ef4444', l: '>50 GB' },
              ]
          ).map(s => (
            <span key={s.l} className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.c }} />
              {s.l}
            </span>
          ))}
        </span>

        <span className="ml-auto px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] uppercase tracking-wide">
          In development
        </span>
      </div>

      {/* Shared navigation bar (same component as the Voronoi view) */}
      <VoronoiBreadcrumb
        breadcrumbParts={breadcrumbParts}
        canGoBack={pathStack.length > 0}
        isLocked={isBusy}
        currentData={data ?? null}
        onNavigateBack={goBack}
        onNavigateToBreadcrumb={jumpTo}
        onDrillDown={drillDown}
      />

      {/* Shared Partition Info panel (same component as the Voronoi view).
          Hover previews; right-click pins. */}
      <div>
        <VoronoiPartitionPanel
          activePartition={activePartition}
          selectedFileInPanel={null}
          onFileClick={() => {}}
          isPartitionFixed={isPartitionFixed}
          heightClassName="sm:h-auto sm:max-h-[420px] opacity-95"
        />
        {isPartitionFixed && (
          <button
            className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => { setIsPartitionFixed(false); setActivePartition(null) }}
          >
            Unpin partition info
          </button>
        )}
      </div>

      {/* Chart container */}
      <div className="relative border border-border rounded-lg bg-card overflow-hidden" style={{ height: '70vh', minHeight: 420 }}>
        <div ref={chartRef} className="absolute inset-0" />

        {/* Sunburst center: always-visible summary (hovered node, or the root) */}
        {chartKind === 'sunburst' && chartData && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center max-w-[180px]">
              <div className="text-sm font-semibold truncate">
                {hoverInfo?.name ?? chartData.name}
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                {formatBytes(hoverInfo?.bytes ?? chartData.bytes)}
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                {compactCount(hoverInfo?.fileCount ?? chartData.fileCount)} files
              </div>
              {hoverInfo && (
                <>
                  <div className="text-3xl font-bold text-primary mt-1">
                    {hoverInfo.pct.toFixed(1)}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    of {chartData.name} ({weightMode === 'files' ? 'files' : 'size'})
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {isBusy && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 pointer-events-none">
            <div className="bg-card border border-border px-8 py-6 rounded-xl shadow-md">
              <GridLoader label="Loading composition data" />
            </div>
          </div>
        )}

        {error != null && !isBusy && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-red-500">Failed to load data: {String(error)}</p>
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Click a cell to drill into that directory. Right-click pins its details in the
        panel below. Toggle between area by storage size or by file count to spot
        directories with many small files.
      </p>
    </div>
  )
}
