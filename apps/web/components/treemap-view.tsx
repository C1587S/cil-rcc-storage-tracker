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
import { quotaForPath } from '@/lib/voronoi/utils/constants'
import { formatBytes } from '@/lib/utils/formatters'
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
  lastModified?: number
  children?: EChartsNode[]
  raw?: any
}

// Continuous severity ramp. Color answers a housekeeping question —
// "is this a small-file problem?" (density) or "is this cold?" (age) —
// on a log scale re-fitted to the cells actually in view, so the channel
// always carries variance instead of collapsing into one bin.
type ColorMode = 'density' | 'age'

const RAMP = ['#4ade80', '#facc15', '#fb923c', '#ef4444']

function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16))
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

function rampColor(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(x))
  return lerpHex(RAMP[i], RAMP[i + 1], x - i)
}

function colorMetric(n: EChartsNode, mode: ColorMode, nowSec: number): number | null {
  if (!n.path) return null // residual cells stay neutral
  if (mode === 'density') {
    if (!n.bytes || !n.fileCount) return null
    return Math.log10(n.fileCount / (n.bytes / 1e12)) // files per TB, log
  }
  if (!n.lastModified) return null
  return Math.log10(Math.max(nowSec - n.lastModified, 3600) / 86400 + 1) // log days since newest file
}

function walkTree(n: EChartsNode, cb: (n: EChartsNode) => void) {
  cb(n)
  n.children?.forEach(c => walkTree(c, cb))
}

/** Assign fills from the in-view p05–p95 metric range; returns the domain
 *  (in metric units) for the legend. */
function applyColorScale(root: EChartsNode, mode: ColorMode, nowSec: number) {
  const vals: number[] = []
  walkTree(root, n => {
    const v = colorMetric(n, mode, nowSec)
    if (v !== null && isFinite(v)) vals.push(v)
  })
  vals.sort((a, b) => a - b)
  const lo = vals.length ? vals[Math.floor(vals.length * 0.05)] : 0
  const hi = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))] : 1
  const span = hi - lo || 1
  walkTree(root, n => {
    if (!n.path) return
    const v = colorMetric(n, mode, nowSec)
    const style: any = (n as any).itemStyle || ((n as any).itemStyle = {})
    style.color = v === null ? '#cbd5e1' : rampColor((v - lo) / span)
  })
  return { lo, hi }
}

function formatDensity(logV: number): string {
  const v = 10 ** logV
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M/TB`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K/TB`
  return `${v.toFixed(v < 10 ? 1 : 0)}/TB`
}

function formatAge(logDays: number): string {
  const d = 10 ** logDays - 1
  if (d >= 365) return `${(d / 365).toFixed(1)} y`
  if (d >= 30) return `${(d / 30).toFixed(0)} mo`
  return `${Math.max(1, Math.round(d))} d`
}

// Shared 2D context for exact text measurement (the label font)
let _measureCtx: CanvasRenderingContext2D | null = null
function measureText(text: string): number {
  if (!_measureCtx) {
    _measureCtx = document.createElement('canvas').getContext('2d')
  }
  if (!_measureCtx) return text.length * 6.7
  _measureCtx.font = "11px 'Courier New', monospace"
  return _measureCtx.measureText(text).width
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

  // The children never sum to the parent: direct files have no child node
  // and small subdirectories are pruned server-side. Without an explicit
  // residual cell that difference renders as confusing blank space.
  let allChildren = children
  if (children && children.length > 0) {
    const childBytes = children.reduce((a, c) => a + (c.bytes || 0), 0)
    const childFiles = children.reduce((a, c) => a + (c.fileCount || 0), 0)
    const residBytes = Math.max(0, bytes - childBytes)
    const residFiles = Math.max(0, fileCount - childFiles)
    const residValue = mode === 'files' ? residFiles : residBytes
    if (residValue > value * 0.005) {
      // Recessive by design: near-background fill, faint hatch, no in-cell
      // label (the legend explains the pattern once)
      allChildren = [...children, {
        name: 'other',
        value: residValue,
        path: '',
        bytes: residBytes,
        fileCount: residFiles,
        directFiles: 0,
        directDirs: 0,
        isDirectory: false,
        raw: undefined,
        itemStyle: {
          color: '#e8eaed',
          borderWidth: 0,
          decal: {
            symbol: 'rect',
            symbolSize: 1,
            dashArrayX: [1, 0],
            dashArrayY: [2, 6],
            rotation: Math.PI / 4,
            color: 'rgba(107, 114, 128, 0.14)',
          },
        },
        label: { show: false },
        emphasis: { disabled: true },
      } as EChartsNode]
    }
  }

  return {
    name: node.name,
    value,
    path: node.path,
    bytes,
    fileCount,
    directFiles: node.originalFiles?.length ?? 0,
    directDirs: childDirs.length,
    isDirectory: true,
    lastModified: node.last_modified || 0,
    children: allChildren && allChildren.length > 0 ? allChildren : undefined,
    raw: node,
    // Leaves (no rendered children) get a flat borderless fill so they can
    // never be confused with framed directory containers. Fill colors are
    // assigned afterwards by applyColorScale.
    ...(allChildren && allChildren.length > 0 ? {} : { itemStyle: { borderWidth: 0 } }),
  }
}

export function TreemapView() {
  const { selectedSnapshot, referencePath, theme, currentUser } = useAppStore()
  const basePath = referencePath || '/project/cil'

  const [visible, setVisible] = useState(false)
  const [chartKind, setChartKind] = useState<ChartKind>('treemap')
  const [weightMode, setWeightMode] = useState<WeightMode>('size')
  // Color answers a housekeeping question; density is the default because
  // small-file problems are this filesystem's chronic disease
  const [colorMode, setColorMode] = useState<ColorMode>('density')
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
    quotaPercent: ((d.bytes || 0) / (1024 ** 4)) / quotaForPath(d.path).storageTB * 100,
    fileQuotaPercent: quotaForPath(d.path).files ? (d.fileCount || 0) / quotaForPath(d.path).files! * 100 : 0,
    depth: 0,
    originalFiles: d.raw?.originalFiles,
    children: d.raw?.children?.filter((c: any) => c.isDirectory),
  }), [])

  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasBoxRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const [canvasH, setCanvasH] = useState(600)
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

  // Monotonic fetch depth per path: lowering the depth selector must never
  // refetch — a depth-4 tree is a subset of the depth-5 data already in
  // memory, so we keep the deepest fetch and slice client-side in
  // toEChartsTree. Only going DEEPER than ever before costs a fetch.
  const maxRequestedRef = useRef<Map<string, number>>(new Map())
  const fetchDepth = Math.max(effectiveDepth, maxRequestedRef.current.get(viewPath) ?? 0)
  maxRequestedRef.current.set(viewPath, fetchDepth)
  useEffect(() => { maxRequestedRef.current.clear() }, [selectedSnapshot])

  const { data, isLoading, isFetching, error } = useVoronoiData({
    selectedSnapshot,
    effectivePath: viewPath,
    enabled: visible && !!selectedSnapshot,
    maxDepth: fetchDepth,
    // Server-side pruning keeps deep fetches small; 0.05% of the root is
    // already a sub-degree sliver in either chart.
    minShare: 0.0005,
    // Full direct-file listings are megabytes per dir; the panel only needs
    // the biggest ones.
    filesLimit: 100,
  })

  const chartData = useMemo(() => {
    if (!data) return null
    const tree = chartKind === 'sunburst'
      ? toEChartsTree(data, weightMode, effectiveDepth, 0, 0, 0.01)
      : toEChartsTree(data, weightMode, depthLimit)
    const nowSec = Math.floor(Date.now() / 1000)
    const domain = applyColorScale(tree, colorMode, nowSec)
    return Object.assign(tree, { __domain: domain })
  }, [data, weightMode, depthLimit, effectiveDepth, chartKind, colorMode])

  const colorDomain = (chartData as any)?.__domain as { lo: number; hi: number } | undefined

  // Near-equal siblings: area communicates nothing — say so instead of
  // letting the chart pretend
  const uniformSiblings = useMemo(() => {
    const kids = chartData?.children?.filter(c => c.path) ?? []
    if (kids.length < 4) return null
    const vals = kids.map(k => k.value).sort((a, b) => a - b)
    return vals[vals.length - 1] / Math.max(vals[0], 1) < 1.5 ? kids.length : null
  }, [chartData])

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
    // Rebuild the stack as the chain of ancestors between the path's own
    // storage root and the path (search can cross roots)
    const root = ['/project/cil', '/cds3/cil'].find(r => path === r || path.startsWith(r + '/')) ?? basePath
    if (path === root) { setPathStack([]); return }
    const rel = path.startsWith(root + '/') ? path.slice(root.length + 1) : ''
    const stack = [root]
    let acc = root
    for (const seg of rel.split('/').slice(0, -1)) {
      acc = `${acc}/${seg}`
      stack.push(acc)
    }
    setPathStack(stack)
  }, [basePath])

  // The trail is built from whichever storage root the current view path
  // actually lives under: search navigation can cross into the other root
  // (e.g. /cds3/cil while the selector is on /project/cil), and the trail
  // must still render and stay clickable.
  const KNOWN_ROOTS = ['/project/cil', '/cds3/cil']
  const viewRoot = KNOWN_ROOTS.find(r => viewPath === r || viewPath.startsWith(r + '/')) ?? basePath

  // Front door of the campaign: any pinned directory becomes a housekeeping
  // target pre-filled with root, path and its current rollup.
  const createTargetFromPartition = useCallback(async () => {
    if (!activePartition?.path || !currentUser) return
    const root = KNOWN_ROOTS.find(r => activePartition.path === r || activePartition.path.startsWith(r + '/'))
    if (!root) { toast('Path is outside the known storage roots', 'error'); return }
    try {
      const res = await fetch(`${API_BASE_URL}/api/housekeeping/targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': currentUser },
        body: JSON.stringify({
          name: activePartition.name,
          root,
          path: activePartition.path,
          scope: 'subtree',
          campaign: root === '/cds3/cil' ? 'cds3-clear' : null,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.detail || res.status)
      toast(`Housekeeping target #${j.id} created: ${activePartition.name} — ${formatBytes(j.bytes)} / ${j.files.toLocaleString()} files. Manage it in the Housekeeping tab.`, 'success')
    } catch (e: any) {
      toast(`Could not create target: ${e.message || e}`, 'error')
    }
  }, [activePartition, currentUser])

  const breadcrumbParts = useMemo(() => {
    const parts: Array<{ name: string; path: string; isClickable: boolean }> = []
    const baseName = viewRoot.split('/').filter(Boolean).pop() || 'root'
    parts.push({ name: baseName, path: viewRoot, isClickable: viewPath !== viewRoot })
    if (viewPath !== viewRoot && viewPath.startsWith(viewRoot + '/')) {
      const rel = viewPath.slice(viewRoot.length + 1)
      let acc = viewRoot
      const segs = rel.split('/')
      segs.forEach((seg, i) => {
        acc = `${acc}/${seg}`
        parts.push({ name: seg, path: acc, isClickable: i < segs.length - 1 })
      })
    }
    return parts
  }, [viewRoot, viewPath])

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

  // Size the canvas to the actual remaining viewport space (banners and
  // hints above shift it, so measure instead of guessing with vh units)
  useEffect(() => {
    const update = () => {
      const el = canvasBoxRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY > window.scrollY
        ? el.getBoundingClientRect().top
        : 0
      setCanvasH(Math.max(380, window.innerHeight - Math.max(top, 0) - 96))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [visible, chartData])

  // Fit-or-drop labelling, pass 2 of 2: AFTER ECharts computes the layout,
  // read every cell's REAL rectangle, measure the label with the real font,
  // and show it only if the full block fits with padding. Cells under
  // 60x24 px get no text under any circumstance. Never truncate, never
  // overflow, never collide — exact geometry, no estimates.
  const realFitPass = useCallback((chart: echarts.ECharts, root: EChartsNode): boolean => {
    // Read verdicts from ECharts' computed layout (getRawDataItem returns
    // CLONES — verified — so verdicts must be applied back onto OUR tree,
    // keyed by path, before re-rendering).
    const verdicts = new Map<string, { label: boolean; header: boolean }>()
    try {
      const model: any = (chart as any).getModel()
      const list = model.getSeriesByIndex(0).getData()
      list.each((idx: number) => {
        const layout = list.getItemLayout(idx)
        const raw: any = list.getRawDataItem(idx)
        if (!layout || !raw?.path) return
        const lines: string[] = [raw.name || '']
        const parts: string[] = []
        if (raw.bytes) parts.push(formatBytes(raw.bytes))
        if (raw.fileCount) parts.push(`${compactCount(raw.fileCount)} files`)
        if (parts.length) lines.push(parts.join(' | '))
        const textW = Math.max(...lines.map(measureText))
        const textH = lines.length * 13
        const isContainer = !!raw.children?.length
        verdicts.set(raw.path, {
          // inner label: leaves only (children occlude containers)
          label: !isContainer && layout.width >= 60 && layout.height >= 24 &&
            textW + 12 <= layout.width && textH + 10 <= layout.height,
          // header strip: full name with padding, or nothing
          header: isContainer && layout.height >= 48 &&
            measureText(raw.name || '') + 14 <= layout.width,
        })
      })
    } catch {
      return false
    }
    if (verdicts.size === 0) return false
    let changed = false
    walkTree(root, (n: any) => {
      if (!n.path) return
      const v = verdicts.get(n.path)
      const show = v?.label ?? false     // unknown to the layout => no label
      const header = v?.header ?? false
      if ((n.label?.show ?? true) !== show) {
        n.label = { ...(n.label || {}), show }
        changed = true
      }
      if ((n.upperLabel?.show ?? false) !== header) {
        n.upperLabel = { show: header }
        changed = true
      }
    })
    return changed
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
          // Collision backstop: anything the estimate lets through that
          // still overlaps gets dropped, not truncated
          labelLayout: { hideOverlap: true },
          label: {
            show: true,
            formatter: (p: any) => {
              const d = p.data as EChartsNode | undefined
              if (!d || !d.name) return ''
              const parts = []
              if (d.bytes) parts.push(formatBytes(d.bytes))
              if (d.fileCount) parts.push(`${compactCount(d.fileCount)} files`)
              return parts.length ? `${d.name}\n${parts.join(' | ')}` : d.name
            },
            fontSize: 11,
            fontFamily: "'Courier New', monospace",
            color: '#1a1a1a',
            overflow: 'none' as const,
          },
          // Hover = outline weight, never a fill change: fill belongs to data
          emphasis: {
            focus: 'none' as const,
            itemStyle: { borderColor: '#3b82f6', borderWidth: 2.5 },
          },
          upperLabel: {
            show: true,
            height: 22,
            fontSize: 11,
            fontFamily: "'Courier New', monospace",
            color: '#1a1a1a',
            backgroundColor: 'rgba(255,255,255,0.35)',
          },
          itemStyle: {
            borderColor: borderColor,
            borderWidth: 1,
            gapWidth: 2,
          },
          // Node colors come from per-node itemStyle (size severity);
          // levels only fade deeper cells slightly for hierarchy depth cues.
          levels: [
            { itemStyle: { borderWidth: 0, gapWidth: 8 } },
            { itemStyle: { borderWidth: 1, gapWidth: 4 } },
            { itemStyle: { borderWidth: 1, gapWidth: 2 } },
            { itemStyle: { borderWidth: 1, gapWidth: 1 } },
            { itemStyle: { borderWidth: 1, gapWidth: 1 } },
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
          emphasis: {
            focus: 'none' as const,
            itemStyle: { borderColor: '#3b82f6', borderWidth: 2.5 },
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

    // Layout is computed synchronously inside setOption: fit labels against
    // the real rectangles and re-apply once if anything changed.
    if (chartKind === 'treemap' && realFitPass(chart, chartData)) {
      chart.setOption({ series: [series] } as any)
    }

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
      if (!d.path) { setHoverInfo({ name: d.name, bytes: d.bytes || 0, fileCount: d.fileCount || 0, pct: 0 }); return }
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
      if (!d || !d.name || !d.path) return
      setActivePartition(toPartitionInfo(d))
      setIsPartitionFixed(true)
    })
  }, [chartData, chartKind, weightMode, depthLimit, theme, viewPath, drillDown, isPartitionFixed, toPartitionInfo, realFitPass, canvasH])

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

        <div className="flex items-center rounded-md border border-border overflow-hidden">
          <span className="px-2 text-[10px] text-muted-foreground uppercase">Color</span>
          <button
            className={cn('px-3 h-8 text-xs transition-colors',
              colorMode === 'density' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
            onClick={() => setColorMode('density')}
            title="Small-file density: files per TB, log scale — red = many small files"
          >
            Density
          </button>
          <button
            className={cn('px-3 h-8 text-xs transition-colors',
              colorMode === 'age' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
            onClick={() => setColorMode('age')}
            title="Time since the newest file in the subtree — red = cold data"
          >
            Age
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-border overflow-hidden">
          <span className="px-2 text-[10px] text-muted-foreground uppercase">Depth</span>
          {[2, 3, 4].map(d => (
            <button
              key={d}
              className={cn(
                'min-w-[28px] px-1.5 h-8 text-xs transition-colors',
                depthLimit === d ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setDepthLimit(d)}
              title={`Show ${d} levels below the current root — drill in for more`}
            >
              {d}
            </button>
          ))}
        </div>

        <span className="ml-auto px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] uppercase tracking-wide">
          In development
        </span>
      </div>

      {/* Shared navigation bar (same component as the Voronoi view) */}
      <div className="relative z-30">
      <VoronoiBreadcrumb
        breadcrumbParts={breadcrumbParts}
        canGoBack={pathStack.length > 0}
        isLocked={isBusy}
        currentData={data ?? null}
        onNavigateBack={goBack}
        onNavigateToBreadcrumb={jumpTo}
        onDrillDown={drillDown}
      />
      </div>

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
          <div className="mt-1 flex items-center gap-4">
            <button
              className="text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => { setIsPartitionFixed(false); setActivePartition(null) }}
            >
              Unpin partition info
            </button>
            {activePartition?.path && currentUser && (
              <>
                <button
                  className="text-[11px] text-primary hover:underline"
                  title={`Create a housekeeping target for ${activePartition.path} (subtree, current rollup)`}
                  onClick={createTargetFromPartition}
                >
                  + Create housekeeping target
                </button>
                <button
                  className="text-[11px] text-primary hover:underline"
                  title="Add this directory to the active custom list (select one in Housekeeping)"
                  onClick={async () => { const m = await addToActiveList([activePartition.path], 'treemap'); toast(m, m.startsWith('Added') ? 'success' : 'info'); }}
                >
                  + Add to list
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {uniformSiblings && (
        <div className="text-[11px] text-muted-foreground px-3 py-1.5 border border-border/50 rounded-md bg-muted/10">
          The {uniformSiblings} directories at this level are nearly the same size — area
          carries little signal here. Color ({colorMode === 'density' ? 'small-file density' : 'age'})
          is the meaningful channel; the Tree Explorer list may also read better.
        </div>
      )}

      {/* Chart container */}
      {/* Navigation bar directly above the canvas — never covers cells */}
      {viewPath !== viewRoot && (
        <div className="flex items-center gap-1.5">
          <button
            className="h-8 px-3 flex items-center gap-1.5 text-xs rounded-md border border-border bg-card shadow-sm text-foreground hover:bg-muted/30 disabled:opacity-40"
            onClick={goBack}
            disabled={pathStack.length === 0 || isBusy}
            title="Back to the previous directory"
          >
            ← Back
          </button>
          <button
            className="h-8 px-3 flex items-center gap-1.5 text-xs rounded-md border border-border bg-card shadow-sm text-muted-foreground hover:text-foreground hover:bg-muted/30"
            onClick={() => jumpTo(viewRoot)}
            disabled={isBusy}
            title={`Jump to ${viewRoot}`}
          >
            ⌂ {viewRoot.split('/').filter(Boolean).pop()}
          </button>
          <span className="h-8 px-3 flex items-center text-xs rounded-md bg-muted/20 text-muted-foreground font-mono max-w-[50vw] truncate" title={viewPath}>
            {viewPath.slice(viewRoot.length) || '/'}
          </span>
        </div>
      )}

      <div ref={canvasBoxRef} className="relative border border-border rounded-lg bg-card overflow-hidden" style={{ height: canvasH, minHeight: 380 }}>
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

      {/* Legend: caption strip directly under the canvas. The gradient shows
          the in-view p05–p95 domain, so it re-fits on every drill-down. */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground border border-border/60 bg-card rounded-md px-4 py-1.5 -mt-1">
        <span className="font-medium text-foreground/80">
          Area = {weightMode === 'size' ? 'storage size' : 'file count'}
        </span>
        <span className="text-muted-foreground/50">|</span>
        <span className="font-medium text-foreground/80">
          Color = {colorMode === 'density' ? 'small-file density' : 'age of newest file'}:
        </span>
        {colorDomain && (
          <span className="inline-flex items-center gap-1.5 font-mono">
            <span>{colorMode === 'density' ? formatDensity(colorDomain.lo) : formatAge(colorDomain.lo)}</span>
            <span className="inline-block w-32 h-2.5 rounded-full border border-black/10"
                  style={{ background: `linear-gradient(90deg, ${RAMP.join(', ')})` }} />
            <span>{colorMode === 'density' ? formatDensity(colorDomain.hi) : formatAge(colorDomain.hi)}</span>
          </span>
        )}
        <span className="text-muted-foreground/60">
          {colorMode === 'density' ? '(red = many small files)' : '(red = cold)'}
        </span>
        <span className="text-muted-foreground/50">|</span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm border border-black/20"
                style={{ background: 'repeating-linear-gradient(45deg, #e8eaed, #e8eaed 2px, #c3c8cf 2px, #c3c8cf 3px)' }} />
          other = direct files + subdirs too small to draw
        </span>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Click a cell to drill into that directory. Right-click pins its details in the
        panel below. Toggle between area by storage size or by file count to spot
        directories with many small files.
      </p>
    </div>
  )
}
