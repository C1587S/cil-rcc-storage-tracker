'use client'

// DEBUG: Confirm file loaded
console.log('[VORONOI] file loaded - UNIFIED v4 with full fixes', new Date().toISOString())

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/lib/store'
import { buildVoronoiTree, type VoronoiNode } from '@/lib/voronoi-data-adapter'
import * as d3 from 'd3'
// @ts-ignore - d3-voronoi-treemap types may not be available
import { voronoiTreemap } from 'd3-voronoi-treemap'
import { formatBytes, getFileExtension } from '@/lib/utils/formatters'
import { getSizeFillColor } from '@/lib/utils/icon-helpers'
import { Button } from '@/components/ui/button'
import { Maximize2, Minimize2, Focus, Target, Folder, FileText, ChevronLeft, HardDrive, Files, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSnapshots } from '@/lib/api'

// --- CONSTANTS & STYLES ---

const TERMINAL_COLORS = {
  background: '#0a0e14',
  backgroundLight: '#161b22',
  folder: '#00ff88',
  file: '#808080',
  text: '#c0c0c0',
  textBright: '#ffffff',
  textDim: '#606060',
  border: '#30363d',
  borderBright: '#58a6ff',
  executable: '#ff6b6b',
  archive: '#ffd700',
  filesContainer: '#4a9eff',
}

// CRITICAL: Hover highlight color as specified
const HOVER_HIGHLIGHT_COLOR = '#0675af'

const FILE_TYPE_COLORS: Record<string, string> = {
  'sh': TERMINAL_COLORS.executable,
  'exe': TERMINAL_COLORS.executable,
  'zip': TERMINAL_COLORS.archive,
  'tar': TERMINAL_COLORS.archive,
  'gz': TERMINAL_COLORS.archive,
  'rar': TERMINAL_COLORS.archive,
  'default': TERMINAL_COLORS.file
}

const STORAGE_QUOTA_TB = 500
const FILE_COUNT_QUOTA = 77_000_000

// --- SEVERITY THRESHOLDS ---

const SIZE_SEVERITY = {
  NEGLIGIBLE: 10 * 1024 * 1024, // 10MB
  SMALL: 1024 * 1024 * 1024, // 1GB
  MEDIUM: 10 * 1024 * 1024 * 1024, // 10GB
  LARGE: 50 * 1024 * 1024 * 1024, // 50GB
}

const FILE_COUNT_SEVERITY = {
  NEGLIGIBLE: 100,
  SMALL: 1000,
  MEDIUM: 10000,
  LARGE: 100000,
}

// --- HELPER FUNCTIONS ---

function getSizeSeverity(size: number): { label: string; color: string } {
  if (size < SIZE_SEVERITY.NEGLIGIBLE) return { label: 'Negligible', color: 'text-gray-500' }
  if (size < SIZE_SEVERITY.SMALL) return { label: 'Small', color: 'text-blue-400' }
  if (size < SIZE_SEVERITY.MEDIUM) return { label: 'Medium', color: 'text-yellow-400' }
  if (size < SIZE_SEVERITY.LARGE) return { label: 'Large', color: 'text-orange-500' }
  return { label: 'Very Large', color: 'text-red-500' }
}

function getFileCountSeverity(count: number): { label: string; color: string } {
  if (count < FILE_COUNT_SEVERITY.NEGLIGIBLE) return { label: 'Negligible', color: 'text-gray-500' }
  if (count < FILE_COUNT_SEVERITY.SMALL) return { label: 'Small', color: 'text-blue-400' }
  if (count < FILE_COUNT_SEVERITY.MEDIUM) return { label: 'Medium', color: 'text-yellow-400' }
  if (count < FILE_COUNT_SEVERITY.LARGE) return { label: 'Large', color: 'text-orange-500' }
  return { label: 'Very Large', color: 'text-red-500' }
}

function getQuotaColor(percent: number): string {
  if (percent >= 95) return "bg-red-600/70"
  if (percent >= 85) return "bg-red-500/65"
  if (percent >= 75) return "bg-orange-500/65"
  if (percent >= 50) return "bg-yellow-400/60"
  return "bg-green-600/70"
}

function getQuotaTextColor(percent: number): string {
  if (percent >= 95) return "text-red-600"
  if (percent >= 75) return "text-orange-500"
  if (percent >= 50) return "text-yellow-400"
  return "text-green-600"
}

function getFileColor(name: string): string {
  const ext = getFileExtension(name).toLowerCase()
  return FILE_TYPE_COLORS[ext] || FILE_TYPE_COLORS['default']
}

function isValidPolygon(polygon: [number, number][]): boolean {
  if (!polygon || polygon.length < 3) return false
  const area = Math.abs(d3.polygonArea(polygon))
  return area > 10
}

function getPolygonBounds(polygon: [number, number][]): { x: number; y: number; width: number; height: number } {
  const xs = polygon.map(p => p[0])
  const ys = polygon.map(p => p[1])
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  }
}

// Constrain point to polygon boundary
function constrainToPolygon(
  x: number,
  y: number,
  polygon: [number, number][],
  padding: number = 0
): [number, number] {
  if (d3.polygonContains(polygon, [x, y])) {
    return [x, y]
  }

  let minDist = Infinity
  let nearest: [number, number] = [x, y]

  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i]
    const p2 = polygon[(i + 1) % polygon.length]

    const dx = p2[0] - p1[0]
    const dy = p2[1] - p1[1]
    const len2 = dx * dx + dy * dy

    if (len2 === 0) continue

    let t = ((x - p1[0]) * dx + (y - p1[1]) * dy) / len2
    t = Math.max(0, Math.min(1, t))

    const projX = p1[0] + t * dx
    const projY = p1[1] + t * dy
    const dist = Math.hypot(x - projX, y - projY)

    if (dist < minDist) {
      minDist = dist
      nearest = [projX, projY]
    }
  }

  const centroid = d3.polygonCentroid(polygon)
  const toCentroid = [centroid[0] - nearest[0], centroid[1] - nearest[1]]
  const len = Math.hypot(toCentroid[0], toCentroid[1])

  if (len > 0) {
    nearest[0] += (toCentroid[0] / len) * (padding + 2)
    nearest[1] += (toCentroid[1] / len) * (padding + 2)
  }

  return nearest
}

// Pack circles within polygon for file bubbles
function packCirclesInPolygon(
  polygon: [number, number][],
  files: Array<{ node: VoronoiNode; value: number }>,
  maxCircles: number = 25
): Array<{ x: number; y: number; r: number; node: VoronoiNode }> {
  if (files.length === 0) return []
  const centroid = d3.polygonCentroid(polygon)
  const area = Math.abs(d3.polygonArea(polygon))

  const topFiles = files.sort((a, b) => b.value - a.value).slice(0, maxCircles)
  const totalSize = topFiles.reduce((sum, f) => sum + f.value, 0)

  const circles: any[] = []
  for (const file of topFiles) {
    const sizeRatio = file.value / totalSize
    let r = Math.max(4, Math.min(Math.sqrt(sizeRatio * area / Math.PI) * 0.6, 25))
    let placed = false
    let attempts = 0

    while (!placed && attempts < 50) {
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * Math.sqrt(area) * 0.4
      const x = centroid[0] + dist * Math.cos(angle)
      const y = centroid[1] + dist * Math.sin(angle)

      if (d3.polygonContains(polygon, [x, y])) {
        const collision = circles.some(c => Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2) < (r + c.r + 2))
        if (!collision) {
          circles.push({ x, y, r, node: file.node })
          placed = true
        }
      }
      attempts++
    }
  }
  return circles
}

// --- TYPES ---

interface PartitionInfo {
  name: string
  path: string
  size: number
  file_count: number
  isDirectory: boolean
  isSynthetic: boolean
  quotaPercent: number
  fileQuotaPercent: number
  parentSize?: number
  parentQuotaPercent?: number
  depth: number
  originalFiles?: VoronoiNode[]
}

interface VoronoiCache {
  path: string
  nodes: any[]
  hierarchy: any
  timestamp: number
}

// --- COMPONENT ---

export function HierarchicalVoronoiView() {
  const { selectedSnapshot, referencePath } = useAppStore()
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const simulationRef = useRef<d3.Simulation<any, undefined> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const [currentNode, setCurrentNode] = useState<VoronoiNode | null>(null)
  const [navigationHistory, setNavigationHistory] = useState<Array<{ node: VoronoiNode | null, path: string }>>([])
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [selectedPartition, setSelectedPartition] = useState<PartitionInfo | null>(null)
  const [hoveredPartition, setHoveredPartition] = useState<PartitionInfo | null>(null)
  const [selectedFileInPanel, setSelectedFileInPanel] = useState<string | null>(null)
  const zoomRef = useRef<any>(null)

  // Voronoi cache for previously computed levels (legacy behavior)
  const voronoiCacheRef = useRef<Map<string, VoronoiCache>>(new Map())

  const { data: snapshots } = useQuery({ queryKey: ['snapshots'], queryFn: getSnapshots })
  const currentSnapshot = snapshots?.find(s => s.snapshot_date === selectedSnapshot)
  const currentPath = currentNode ? currentNode.path : (referencePath || '/project/cil')

  // Fetch ONLY 2 levels deep for performance (root + 1 preview level)
  // Deeper levels computed on-demand after drill-down
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['voronoi-tree-hierarchical', selectedSnapshot, currentPath],
    queryFn: () => buildVoronoiTree(selectedSnapshot!, currentPath, 2, 1000),
    enabled: !!selectedSnapshot && !!currentPath,
    placeholderData: (prev) => prev,
    staleTime: 1000 * 60 * 5,
  })

  const projectSize = data ? data.size : 0
  const storageTB = projectSize / (1024 ** 4)
  const storageQuotaPercent = (storageTB / STORAGE_QUOTA_TB) * 100

  // Parent size for relative quota (current directory's size)
  const parentSize = currentNode ? currentNode.size : projectSize

  // Calculate partition quota percentage (relative to project root)
  const getPartitionQuotaPercent = useCallback((size: number) => {
    return projectSize > 0 ? (size / projectSize) * 100 : 0
  }, [projectSize])

  // Calculate file quota percentage
  const getFileQuotaPercent = useCallback((fileCount: number) => {
    return (fileCount / FILE_COUNT_QUOTA) * 100
  }, [])

  // Calculate parent-relative quota percentage
  const getParentQuotaPercent = useCallback((size: number) => {
    return parentSize > 0 ? (size / parentSize) * 100 : 0
  }, [parentSize])

  // LEGACY BEHAVIOR: Only depth-1 partitions are clickable/explorable
  // Deeper partitions are shown in "preview mode" but not interactable
  const handleDrillDown = useCallback((node: VoronoiNode, depth: number) => {
    // Only allow drilling into depth-1 (top-level) partitions - LEGACY BEHAVIOR
    if (depth !== 1) {
      console.log('[NAV] Ignoring click on preview partition (depth:', depth, ')')
      return
    }
    if (isTransitioning || isFetching || !node.isDirectory || (node as any).isSynthetic) return

    console.log('[NAV] Drilling into:', node.path)
    setIsTransitioning(true)

    // Save current state to history
    if (currentNode) {
      setNavigationHistory(prev => [...prev, { node: currentNode, path: currentNode.path }])
    } else {
      setNavigationHistory(prev => [...prev, { node: null, path: referencePath || '/project/cil' }])
    }

    setCurrentNode(node)
    setSelectedPartition(null)
    setHoveredPartition(null)
    setSelectedFileInPanel(null)
    setTimeout(() => setIsTransitioning(false), 500)
  }, [currentNode, isTransitioning, isFetching, referencePath])

  // Right-click to inspect/select partition
  const handleInspect = useCallback((partitionInfo: PartitionInfo, element: SVGPathElement) => {
    console.log('[UI] Inspecting partition:', partitionInfo.name)

    // Clear previous highlights
    d3.selectAll('.voronoi-partition')
      .classed('selected', false)
      .style('filter', 'none')

    // Apply persistent highlight
    d3.select(element)
      .classed('selected', true)
      .style('filter', `drop-shadow(0 0 12px ${HOVER_HIGHLIGHT_COLOR})`)

    setSelectedPartition(partitionInfo)
    setSelectedFileInPanel(null)
  }, [])

  // Navigate back one level - LEGACY BEHAVIOR
  const navigateBack = useCallback(() => {
    if (isTransitioning || isFetching || navigationHistory.length === 0) return

    setIsTransitioning(true)
    const lastEntry = navigationHistory[navigationHistory.length - 1]
    setCurrentNode(lastEntry.node)
    setNavigationHistory(prev => prev.slice(0, -1))
    setSelectedPartition(null)
    setHoveredPartition(null)
    setSelectedFileInPanel(null)
    setTimeout(() => setIsTransitioning(false), 500)
  }, [navigationHistory, isTransitioning, isFetching])

  const navigateToPathIndex = useCallback((index: number, rootPartsCount: number) => {
    if (isTransitioning || isFetching) return
    setIsTransitioning(true)

    if (index < rootPartsCount) {
      setNavigationHistory([])
      setCurrentNode(null)
    } else {
      const historyIndex = index - rootPartsCount
      if (historyIndex < navigationHistory.length) {
        setCurrentNode(navigationHistory[historyIndex].node)
        setNavigationHistory(prev => prev.slice(0, historyIndex))
      }
    }
    setSelectedPartition(null)
    setHoveredPartition(null)
    setSelectedFileInPanel(null)
    setTimeout(() => setIsTransitioning(false), 500)
  }, [navigationHistory, isTransitioning, isFetching])

  const resetToRoot = useCallback(() => {
    if (isTransitioning || isFetching) return
    setIsTransitioning(true)
    setCurrentNode(null)
    setNavigationHistory([])
    setSelectedPartition(null)
    setHoveredPartition(null)
    setSelectedFileInPanel(null)
    setTimeout(() => setIsTransitioning(false), 500)
  }, [isTransitioning, isFetching])

  // Zoom/pan reset
  const resetZoom = useCallback(() => {
    if (zoomRef.current && svgRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(500)
        .call(zoomRef.current.transform, d3.zoomIdentity)
    }
  }, [])

  const toggleFullscreen = async () => {
    if (!wrapperRef.current) return
    try {
      if (!isFullscreen) {
        await wrapperRef.current.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    } catch (e) {
      console.error('Fullscreen error:', e)
    }
  }

  // Handle file click in panel - highlight corresponding bubble
  const handleFileClickInPanel = useCallback((filePath: string) => {
    setSelectedFileInPanel(filePath)

    // Highlight the bubble
    d3.selectAll('.file-bubble')
      .classed('highlighted', false)
      .attr('stroke-width', 0.5)
      .attr('stroke', 'rgba(255,255,255,0.4)')

    d3.select(`.file-bubble[data-path="${filePath}"]`)
      .classed('highlighted', true)
      .attr('stroke-width', 2.5)
      .attr('stroke', HOVER_HIGHLIGHT_COLOR)
      .raise()
  }, [])

  // --- MAIN RENDER EFFECT ---
  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current || isTransitioning) return

    // Stop any existing simulation
    if (simulationRef.current) {
      simulationRef.current.stop()
      simulationRef.current = null
    }

    const container = containerRef.current
    const width = container.clientWidth
    const height = isFullscreen ? window.innerHeight - 280 : 550

    if (width === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg
      .attr('width', width)
      .attr('height', height)
      .style('background', TERMINAL_COLORS.background)

    const defs = svg.append('defs')
    const g = svg.append('g').attr('id', 'voronoi-root')

    // Zoom with constrained panning - LEGACY BEHAVIOR
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 10])
      .translateExtent([[0, 0], [width, height]])
      .extent([[0, 0], [width, height]])
      .on('zoom', (event) => g.attr('transform', event.transform))

    svg.call(zoom)
    zoomRef.current = zoom

    // Transform data with synthetic file containers
    const prepareHierarchy = (n: VoronoiNode, depth: number = 0): any => {
      const uniqueId = `node-${Math.random().toString(36).substr(2, 9)}`

      if (!n.children || n.children.length === 0) {
        return { ...n, uniqueId, depth }
      }

      const dirs = n.children.filter(c => c.isDirectory)
      const files = n.children.filter(c => !c.isDirectory)

      const children = dirs.map(d => prepareHierarchy(d, depth + 1))

      // Create synthetic __files__ container for loose files
      if (files.length > 0) {
        const filesSize = files.reduce((acc, f) => acc + f.size, 0)
        children.push({
          name: '__files__',
          path: `${n.path}/__files__`,
          size: filesSize,
          isDirectory: false,
          isSynthetic: true,
          originalFiles: files,
          file_count: files.length,
          depth: depth + 1,
          uniqueId: `files-${Math.random().toString(36).substr(2, 9)}`
        })
      }

      return { ...n, children, uniqueId, depth }
    }

    const hierarchyData = prepareHierarchy(data)
    const hierarchy = d3.hierarchy(hierarchyData)
      .sum(d => (!d.children || d.children.length === 0) ? Math.max(d.size || 1, 1) : 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const padding = 15
    const clip: [number, number][] = [
      [padding, padding],
      [width - padding, padding],
      [width - padding, height - padding],
      [padding, height - padding]
    ]

    // Apply Voronoi treemap recursively
    const treemap = voronoiTreemap()
      .clip(clip)
      .maxIterationCount(50)
      .convergenceRatio(0.01)

    // LAZY RENDERING: Only compute Voronoi for root + 2 preview levels
    // Deeper partitions computed on-demand after drill-down
    const applyVoronoiRecursively = (h: d3.HierarchyNode<any>, poly: any, depth: number) => {
      try {
        treemap.clip(poly)(h)
        // CRITICAL: Only recurse up to depth 2 for preview (0=root, 1=first level, 2=second preview level)
        // This prevents eager computation of entire tree hierarchy
        if (depth < 2 && h.children) {
          h.children.forEach(child => {
            if (child.data.isDirectory && !child.data.isSynthetic && (child as any).polygon) {
              applyVoronoiRecursively(child, (child as any).polygon, depth + 1)
            }
          })
        }
      } catch (err) {
        console.warn('Voronoi compute error at depth', depth, err)
      }
    }

    console.log('[Voronoi Compute] Starting lazy computation (max depth 2)')
    applyVoronoiRecursively(hierarchy, clip, 0)
    console.log('[Voronoi Compute] Completed')

    // Collect all nodes with valid polygons
    const allNodes = hierarchy.descendants().filter(d => {
      if (d.depth === 0) return false
      const polygon = (d as any).polygon
      return polygon && isValidPolygon(polygon)
    })

    // Create clip paths
    allNodes.forEach(d => {
      const polygon = (d as any).polygon
      const nodeData = d.data
      defs.append('clipPath')
        .attr('id', `clip-${nodeData.uniqueId}`)
        .append('path')
        .attr('d', 'M' + polygon.map((p: [number, number]) => p.join(',')).join('L') + 'Z')
    })

    // --- RENDER PARTITIONS ---
    // VISUALIZATION DEPTH RULES (LAZY MODE):
    // - depth 1: fully interactive (clickable, hoverable)
    // - depth 2: preview mode only (semi-transparent, NOT interactable)
    // - depth 3+: NOT COMPUTED at initial load (on-demand only after drill-down)

    const depthCounts = allNodes.reduce((acc, d) => {
      acc[d.depth] = (acc[d.depth] || 0) + 1
      return acc
    }, {} as Record<number, number>)
    console.log('[Voronoi Render] Rendering', allNodes.length, 'partitions. Depth distribution:', depthCounts)

    allNodes.forEach((d: any) => {
      const node = d.data
      const poly = d.polygon
      if (!poly) return

      const nodeDepth = d.depth
      const isSynthetic = node.isSynthetic
      const isTopLevel = nodeDepth === 1
      const isPreview = nodeDepth === 2  // Only depth 2 is preview (depth 3+ not computed)

      // Determine colors and opacity based on depth
      let fillColor: string
      let fillOpacity: number
      let strokeColor: string
      let strokeWidth: number
      let strokeOpacity: number

      if (isSynthetic) {
        // Files container styling
        fillColor = TERMINAL_COLORS.filesContainer
        fillOpacity = isTopLevel ? 0.12 : 0.04
        strokeColor = TERMINAL_COLORS.filesContainer
        strokeWidth = isTopLevel ? 1.5 : 0.5
        strokeOpacity = isTopLevel ? 0.6 : 0.3
      } else if (node.isDirectory) {
        // Directory styling
        fillColor = getSizeFillColor(node.size)
        fillOpacity = isTopLevel ? 0.2 : (isPreview ? 0.03 : 0.15)
        // CRITICAL: Preview partitions (depth 2) show as bright white veins
        strokeColor = isTopLevel ? fillColor : (isPreview ? '#ffffff' : TERMINAL_COLORS.border)
        strokeWidth = isTopLevel ? 2.5 : (isPreview ? 1.5 : 1)
        strokeOpacity = isTopLevel ? 0.7 : (isPreview ? 0.85 : 0.5)
      } else {
        // Standalone file
        fillColor = getFileColor(node.name)
        fillOpacity = isTopLevel ? 0.3 : 0.1
        strokeColor = fillColor
        strokeWidth = isTopLevel ? 1 : 0.5
        strokeOpacity = isTopLevel ? 0.6 : 0.2
      }

      // Create partition info for panel
      const partitionInfo: PartitionInfo = {
        name: isSynthetic ? `Files (${node.file_count})` : node.name,
        path: node.path,
        size: node.size,
        file_count: node.file_count || 0,
        isDirectory: node.isDirectory,
        isSynthetic: isSynthetic,
        quotaPercent: getPartitionQuotaPercent(node.size),
        fileQuotaPercent: getFileQuotaPercent(node.file_count || 0),
        parentSize: parentSize,
        parentQuotaPercent: getParentQuotaPercent(node.size),
        depth: nodeDepth,
        originalFiles: node.originalFiles
      }

      // CRITICAL: Render partition background first
      g.append('path')
        .attr('class', cn('voronoi-partition-bg', isTopLevel && 'interactive', isPreview && 'preview'))
        .attr('d', `M${poly.join('L')}Z`)
        .attr('fill', fillColor)
        .attr('fill-opacity', fillOpacity)
        .attr('stroke', strokeColor)
        .attr('stroke-width', strokeWidth)
        .attr('stroke-opacity', strokeOpacity)
        .attr('stroke-dasharray', isSynthetic ? '4,2' : 'none')
        .style('pointer-events', 'none') // Background doesn't receive events
        .datum({ ...partitionInfo, baseColor: fillColor, baseFillOpacity: fillOpacity, baseStrokeColor: strokeColor })

      // Labels - render for all top-level partitions with minimal size threshold
      const bounds = getPolygonBounds(poly)

      // CRITICAL: Reduced threshold from 50x30 to 30x20 to show more labels
      if (isTopLevel && bounds.width > 30 && bounds.height > 20) {
        const centroid = d3.polygonCentroid(poly)
        const displayName = isSynthetic
          ? `${node.file_count} files`
          : (node.name.length > 20 ? node.name.slice(0, 17) + '...' : node.name)

        // CRITICAL: Medium gray fill with white stroke for readability
        const fontSize = Math.min(13, Math.max(7, bounds.width / displayName.length * 1.2))

        g.append('text')
          .attr('x', centroid[0])
          .attr('y', centroid[1])
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('fill', isSynthetic ? TERMINAL_COLORS.filesContainer : '#b0b0b0')
          .attr('stroke', 'white')
          .attr('stroke-width', 0.5)
          .attr('font-size', fontSize)
          .attr('font-weight', '600')
          .attr('font-family', 'monospace')
          .style('pointer-events', 'none')
          .style('paint-order', 'stroke fill')
          .text(displayName)
      }

      // Render file bubbles inside synthetic __files__ containers with physics
      if (isSynthetic && node.originalFiles && isTopLevel) {
        const fileCircles = packCirclesInPolygon(
          poly,
          node.originalFiles.map((f: any) => ({ node: f, value: f.size })),
          20
        )

        // Create bubbles with drag and tooltip
        fileCircles.forEach((c, idx) => {
          const bubbleId = `bubble-${node.uniqueId}-${idx}`

          const bubble = g.append('circle')
            .attr('class', 'file-bubble')
            .attr('id', bubbleId)
            .attr('data-path', c.node.path)
            .attr('cx', c.x)
            .attr('cy', c.y)
            .attr('r', c.r)
            .attr('fill', getFileColor(c.node.name))
            .attr('fill-opacity', 0.7)
            .attr('stroke', 'rgba(255,255,255,0.4)')
            .attr('stroke-width', 0.5)
            .attr('clip-path', `url(#clip-${node.uniqueId})`)
            .style('cursor', 'grab')
            .style('pointer-events', 'all') // Bubbles are interactive
            .lower() // CRITICAL: Move bubbles BELOW partition path so partition receives clicks
            .datum({ ...c, polygon: poly, centroid: d3.polygonCentroid(poly) })

          // Bubble hover with tooltip
          bubble
            .on('mouseenter', function(event: MouseEvent) {
              const tooltip = tooltipRef.current
              if (!tooltip) return

              tooltip.style.display = 'block'
              tooltip.style.left = event.pageX + 10 + 'px'
              tooltip.style.top = event.pageY + 10 + 'px'
              tooltip.innerHTML = `
                <div class="font-mono text-xs">
                  <div class="font-bold text-cyan-400">${c.node.name}</div>
                  <div class="text-gray-400">${formatBytes(c.node.size)}</div>
                </div>
              `

              d3.select(this)
                .attr('stroke', HOVER_HIGHLIGHT_COLOR)
                .attr('stroke-width', 2)
            })
            .on('mousemove', function(event: MouseEvent) {
              const tooltip = tooltipRef.current
              if (!tooltip) return
              tooltip.style.left = event.pageX + 10 + 'px'
              tooltip.style.top = event.pageY + 10 + 'px'
            })
            .on('mouseleave', function() {
              const tooltip = tooltipRef.current
              if (tooltip) tooltip.style.display = 'none'

              const isHighlighted = d3.select(this).classed('highlighted')
              if (!isHighlighted) {
                d3.select(this)
                  .attr('stroke', 'rgba(255,255,255,0.4)')
                  .attr('stroke-width', 0.5)
              }
            })
        })

        // Physics simulation for bubbles with boundary constraint
        interface BubbleNode extends d3.SimulationNodeDatum {
          id: string
          r: number
          node: VoronoiNode
          polygon: any
        }

        const bubbleNodes: BubbleNode[] = fileCircles.map((c, idx) => ({
          id: `bubble-${node.uniqueId}-${idx}`,
          x: c.x,
          y: c.y,
          r: c.r,
          node: c.node,
          polygon: poly
        }))

        const simulation = d3.forceSimulation(bubbleNodes)
          .force('collision', d3.forceCollide<BubbleNode>().radius(d => d.r + 1).strength(0.8))
          .force('center', d3.forceCenter(d3.polygonCentroid(poly)[0], d3.polygonCentroid(poly)[1]).strength(0.05))
          .force('charge', d3.forceManyBody<BubbleNode>().strength(-5))
          .alphaDecay(0.05)
          .on('tick', () => {
            bubbleNodes.forEach(b => {
              // Constrain to polygon
              const constrained = constrainToPolygon(b.x!, b.y!, b.polygon, b.r)
              b.x = constrained[0]
              b.y = constrained[1]
            })

            g.selectAll<SVGCircleElement, any>('.file-bubble')
              .each(function(d: any) {
                const bn = bubbleNodes.find(b => b.node.path === d.node.path)
                if (bn) {
                  d3.select(this).attr('cx', bn.x!).attr('cy', bn.y!)
                }
              })
          })

        simulationRef.current = simulation

        // Drag behavior with physics
        const drag = d3.drag<SVGCircleElement, any>()
          .on('start', function(event) {
            if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0.3).restart()
            d3.select(this).style('cursor', 'grabbing')
            const d = d3.select(this).datum() as any
            const bn = bubbleNodes.find(b => b.node.path === d.node.path)
            if (bn) {
              bn.fx = bn.x
              bn.fy = bn.y
            }
          })
          .on('drag', function(event) {
            const d = d3.select(this).datum() as any
            const bn = bubbleNodes.find(b => b.node.path === d.node.path)
            if (bn) {
              const constrained = constrainToPolygon(event.x, event.y, d.polygon, bn.r)
              bn.fx = constrained[0]
              bn.fy = constrained[1]
            }
          })
          .on('end', function(event) {
            if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0)
            d3.select(this).style('cursor', 'grab')
            const d = d3.select(this).datum() as any
            const bn = bubbleNodes.find(b => b.node.path === d.node.path)
            if (bn) {
              bn.fx = null
              bn.fy = null
            }
          })

        g.selectAll('.file-bubble').call(drag as any)
      }
    })

    // CRITICAL: Second pass - add transparent interaction overlays ABOVE all content
    // This ensures full-area hover/click works even when bubbles are present
    allNodes.forEach((d: any) => {
      const node = d.data
      const poly = d.polygon
      if (!poly) return

      const nodeDepth = d.depth
      const isSynthetic = node.isSynthetic
      const isTopLevel = nodeDepth === 1

      // Only create interaction overlay for top-level partitions
      if (!isTopLevel) return

      // Create partition info for events
      const partitionInfo: PartitionInfo = {
        name: isSynthetic ? `Files (${node.file_count})` : node.name,
        path: node.path,
        size: node.size,
        file_count: node.file_count || 0,
        isDirectory: node.isDirectory,
        isSynthetic: isSynthetic,
        quotaPercent: getPartitionQuotaPercent(node.size),
        fileQuotaPercent: getFileQuotaPercent(node.file_count || 0),
        parentSize: parentSize,
        parentQuotaPercent: getParentQuotaPercent(node.size),
        depth: nodeDepth,
        originalFiles: node.originalFiles
      }

      // Create transparent interaction overlay
      const interactionOverlay = g.append('path')
        .attr('class', 'voronoi-interaction-overlay')
        .attr('d', `M${poly.join('L')}Z`)
        .attr('fill', 'transparent')
        .attr('stroke', 'none')
        .style('cursor', (!isSynthetic && node.isDirectory) ? 'pointer' : 'default')
        .style('pointer-events', 'all') // CRITICAL: Full area interaction
        .datum(partitionInfo)

      // HOVER EVENTS - Update background when hovering overlay
      interactionOverlay
        .on('mouseenter', function() {
          const data = d3.select(this).datum() as any
          const bg = g.selectAll('.voronoi-partition-bg').filter((bgData: any) => bgData && bgData.path === data.path)

          if (!bg.classed('selected')) {
            bg.attr('fill', HOVER_HIGHLIGHT_COLOR)
              .attr('fill-opacity', isSynthetic ? 0.2 : 0.35)
              .attr('stroke', HOVER_HIGHLIGHT_COLOR)
              .attr('stroke-width', 3.5)
              .attr('stroke-opacity', 1)
              .style('filter', `drop-shadow(0 0 8px ${HOVER_HIGHLIGHT_COLOR})`)
          }

          setHoveredPartition(data)
        })
        .on('mouseleave', function() {
          const data = d3.select(this).datum() as any
          const bg = g.selectAll('.voronoi-partition-bg').filter((bgData: any) => bgData && bgData.path === data.path)

          if (!bg.classed('selected')) {
            bg.attr('fill', (bgData: any) => bgData.baseColor)
              .attr('fill-opacity', (bgData: any) => bgData.baseFillOpacity)
              .attr('stroke', (bgData: any) => bgData.baseStrokeColor)
              .attr('stroke-width', isSynthetic ? 1.5 : 2.5)
              .attr('stroke-opacity', isSynthetic ? 0.6 : 0.7)
              .style('filter', 'none')
          }

          setHoveredPartition(null)
        })

      // Right-click to inspect
      interactionOverlay.on('contextmenu', (e: MouseEvent) => {
        e.preventDefault()
        const data = d3.select(e.currentTarget as SVGPathElement).datum() as any
        const bg = g.selectAll('.voronoi-partition-bg').filter((bgData: any) => bgData && bgData.path === data.path)

        // Clear all selections
        g.selectAll('.voronoi-partition-bg').classed('selected', false).style('filter', 'none')

        // Mark as selected
        bg.classed('selected', true).style('filter', `drop-shadow(0 0 12px ${HOVER_HIGHLIGHT_COLOR})`)

        setSelectedPartition(partitionInfo)
        setSelectedFileInPanel(null)
      })

      // Left-click to drill (only for directories, not synthetic)
      if (!isSynthetic && node.isDirectory) {
        interactionOverlay.on('click', (e: MouseEvent) => {
          e.stopPropagation()
          handleDrillDown(node, nodeDepth)
        })
      }
    })

  }, [data, currentNode, isTransitioning, isFullscreen, handleDrillDown, handleInspect, getPartitionQuotaPercent, getFileQuotaPercent, getParentQuotaPercent, parentSize, selectedFileInPanel])

  // --- BREADCRUMB ---
  const buildBreadcrumb = useCallback(() => {
    const parts: Array<{ name: string; isClickable: boolean; index: number }> = []
    const rootPath = referencePath || '/project/cil'
    const rootPathParts = rootPath === '/' ? ['root'] : rootPath.split('/').filter(Boolean)

    rootPathParts.forEach((p, i) => {
      parts.push({ name: p, isClickable: true, index: i })
    })

    navigationHistory.forEach((h, i) => {
      if (h.node) {
        parts.push({ name: h.node.name, isClickable: true, index: rootPathParts.length + i })
      }
    })

    if (currentNode) {
      parts.push({ name: currentNode.name, isClickable: false, index: parts.length })
    }

    return { parts, rootPartsCount: rootPathParts.length }
  }, [referencePath, navigationHistory, currentNode])

  const { parts: pathParts, rootPartsCount } = buildBreadcrumb()
  const canGoBack = navigationHistory.length > 0 || currentNode !== null

  // Active partition for display (hovered takes precedence over selected)
  const activePartition = hoveredPartition || selectedPartition

  return (
    <div ref={wrapperRef} className={cn(
      "space-y-3 font-mono text-xs",
      isFullscreen && "fixed inset-0 z-50 bg-[#0a0e14] p-4"
    )}>
      {/* Tooltip for bubbles */}
      <div
        ref={tooltipRef}
        className="fixed pointer-events-none z-50 bg-black/90 border border-cyan-600 rounded px-2 py-1 hidden"
      />

      {/* HEADER & QUOTA */}
      <div className="flex flex-col border-b border-gray-800 pb-3 gap-3">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-bold text-white uppercase tracking-widest">Storage Voronoi Topology</h2>
            <p className="text-gray-500">{selectedSnapshot} · Snapshot Data</p>
          </div>
        </div>

        {/* DUAL QUOTA BARS */}
        <div className="space-y-2">
          {/* Global Storage Quota (always relative to /project/cil) */}
          <div className="flex items-center gap-2">
            <span className="text-gray-500 whitespace-nowrap text-[10px]">GLOBAL QUOTA:</span>
            <div className="flex-1 h-2 bg-gray-900 rounded-full overflow-hidden border border-gray-800">
              <div className={cn("h-full transition-all duration-1000", getQuotaColor(storageQuotaPercent))} style={{ width: `${Math.min(storageQuotaPercent, 100)}%` }} />
            </div>
            <span className={cn("font-bold min-w-[50px] text-right text-[10px]", getQuotaTextColor(storageQuotaPercent))}>{storageQuotaPercent.toFixed(1)}%</span>
            <span className="text-gray-600 text-[9px]">({formatBytes(projectSize)} / {STORAGE_QUOTA_TB}TB)</span>
          </div>

          {/* Parent-Relative Quota */}
          {currentNode && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500 whitespace-nowrap text-[10px]">PARENT DIR:</span>
              <div className="flex-1 h-2 bg-gray-900 rounded-full overflow-hidden border border-gray-800">
                <div className="h-full bg-cyan-600/70 transition-all duration-1000" style={{ width: '100%' }} />
              </div>
              <span className="font-bold min-w-[50px] text-right text-[10px] text-cyan-400">100%</span>
              <span className="text-gray-600 text-[9px]">({formatBytes(parentSize)})</span>
            </div>
          )}
        </div>
      </div>

      {/* TOP ROW: Partition Info Panel + Interaction Guide */}
      <div className="flex gap-3">
        {/* PARTITION INFORMATION PANEL - ENHANCED WITH 4 METRICS */}
        <div className="flex-1 bg-[#161b22] border border-gray-800 rounded-lg overflow-hidden">
          <div className="bg-gray-800/50 px-3 py-2 border-b border-gray-700 flex items-center gap-2">
            <Target className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-white uppercase text-[10px] tracking-wider">Partition Info</span>
            {activePartition && (
              <span className="ml-auto text-[9px] text-gray-500">
                {activePartition.depth === 1 ? 'INTERACTIVE' : 'PREVIEW'}
              </span>
            )}
          </div>

          <div className="p-3">
            {activePartition ? (
              <div className="space-y-3">
                {/* Header with icon and name */}
                <div className="flex items-start gap-4">
                  <div className="flex items-center gap-2">
                    {activePartition.isSynthetic ? (
                      <Files className="w-6 h-6 text-blue-400" />
                    ) : activePartition.isDirectory ? (
                      <Folder className="w-6 h-6 text-green-400" />
                    ) : (
                      <FileText className="w-6 h-6 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold truncate">{activePartition.name}</p>
                    <p className="text-gray-500 text-[10px] truncate">{activePartition.path}</p>
                  </div>
                </div>

                {/* 4 KEY METRICS */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Size */}
                  <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                    <div className="flex items-center gap-1 mb-1">
                      <HardDrive className="w-3 h-3 text-gray-600" />
                      <label className="text-gray-600 text-[9px]">SIZE</label>
                    </div>
                    <div className="text-cyan-400 font-bold text-sm">{formatBytes(activePartition.size)}</div>
                    <div className={cn("text-[9px]", getSizeSeverity(activePartition.size).color)}>
                      {getSizeSeverity(activePartition.size).label}
                    </div>
                  </div>

                  {/* Storage Quota % */}
                  <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                    <div className="flex items-center gap-1 mb-1">
                      <BarChart3 className="w-3 h-3 text-gray-600" />
                      <label className="text-gray-600 text-[9px]">STORAGE QUOTA</label>
                    </div>
                    <div className={cn("font-bold text-sm", getQuotaTextColor(activePartition.quotaPercent))}>
                      {activePartition.quotaPercent.toFixed(2)}%
                    </div>
                    <div className="text-gray-500 text-[9px]">of {STORAGE_QUOTA_TB}TB</div>
                  </div>

                  {/* File Count */}
                  <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                    <div className="flex items-center gap-1 mb-1">
                      <Files className="w-3 h-3 text-gray-600" />
                      <label className="text-gray-600 text-[9px]">FILE COUNT</label>
                    </div>
                    <div className="text-white font-bold text-sm">
                      {activePartition.file_count > 0 ? activePartition.file_count.toLocaleString() : '—'}
                    </div>
                    {activePartition.file_count > 0 && (
                      <div className={cn("text-[9px]", getFileCountSeverity(activePartition.file_count).color)}>
                        {getFileCountSeverity(activePartition.file_count).label}
                      </div>
                    )}
                  </div>

                  {/* File Quota % */}
                  <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                    <div className="flex items-center gap-1 mb-1">
                      <BarChart3 className="w-3 h-3 text-gray-600" />
                      <label className="text-gray-600 text-[9px]">FILE QUOTA</label>
                    </div>
                    <div className={cn("font-bold text-sm", getQuotaTextColor(activePartition.fileQuotaPercent))}>
                      {activePartition.fileQuotaPercent.toFixed(3)}%
                    </div>
                    <div className="text-gray-500 text-[9px]">of {(FILE_COUNT_QUOTA / 1_000_000).toFixed(0)}M</div>
                  </div>
                </div>

                {/* Parent-relative quota */}
                {activePartition.parentQuotaPercent !== undefined && activePartition.parentQuotaPercent < 100 && (
                  <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                    <div className="flex items-center gap-1 mb-1">
                      <BarChart3 className="w-3 h-3 text-gray-600" />
                      <label className="text-gray-600 text-[9px]">% OF PARENT DIR</label>
                    </div>
                    <div className={cn("font-bold", getQuotaTextColor(activePartition.parentQuotaPercent))}>
                      {activePartition.parentQuotaPercent.toFixed(1)}%
                    </div>
                  </div>
                )}

                {/* LOOSE FILES LIST (if synthetic partition) */}
                {activePartition.isSynthetic && activePartition.originalFiles && activePartition.originalFiles.length > 0 && (
                  <div className="bg-black/30 px-3 py-2 rounded border border-gray-800 max-h-48 overflow-y-auto">
                    <div className="text-gray-500 text-[9px] uppercase mb-2">Files in this region:</div>
                    <div className="space-y-1">
                      {activePartition.originalFiles.slice(0, 50).map((file, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleFileClickInPanel(file.path)}
                          className={cn(
                            "flex items-center justify-between gap-2 p-1 rounded hover:bg-cyan-950/30 cursor-pointer transition-colors",
                            selectedFileInPanel === file.path && "bg-cyan-950/50 border border-cyan-700"
                          )}
                        >
                          <span className="text-white text-[10px] truncate flex-1">{file.name}</span>
                          <span className="text-gray-400 text-[9px] whitespace-nowrap">{formatBytes(file.size)}</span>
                        </div>
                      ))}
                      {activePartition.originalFiles.length > 50 && (
                        <div className="text-gray-600 text-[9px] italic pt-1">
                          + {activePartition.originalFiles.length - 50} more files
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 text-gray-600 py-2">
                <Focus className="w-5 h-5" />
                <span className="italic">Hover or right-click a partition to view details</span>
              </div>
            )}
          </div>
        </div>

        {/* INTERACTION GUIDE */}
        <div className="w-56 bg-[#161b22]/50 border border-gray-800 rounded-lg p-3">
          <h4 className="text-white font-bold uppercase text-[9px] tracking-widest border-b border-gray-800 pb-2 mb-2">Controls</h4>
          <div className="space-y-1.5 text-[10px]">
            <div className="flex gap-2">
              <span className="text-green-500 font-bold w-14">L-CLICK:</span>
              <span className="text-gray-400">Drill into</span>
            </div>
            <div className="flex gap-2">
              <span className="text-cyan-400 font-bold w-14">R-CLICK:</span>
              <span className="text-gray-400">Select partition</span>
            </div>
            <div className="flex gap-2">
              <span className="text-gray-200 font-bold w-14">SCROLL:</span>
              <span className="text-gray-400">Zoom</span>
            </div>
            <div className="flex gap-2">
              <span className="text-yellow-400 font-bold w-14">DRAG:</span>
              <span className="text-gray-400">Pan view</span>
            </div>
            <div className="flex gap-2">
              <span className="text-purple-400 font-bold w-14">BUBBLES:</span>
              <span className="text-gray-400">Drag files</span>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-gray-800 text-[9px] text-gray-600">
            <span className="text-cyan-600">●</span> Interactive &nbsp;
            <span className="text-gray-700">●</span> Preview
          </div>
        </div>
      </div>

      {/* BREADCRUMB NAVIGATION */}
      <div className="bg-[#0a0e14] border border-gray-800 p-2 rounded flex items-center gap-2 overflow-x-auto">
        {/* Back Button */}
        <button
          onClick={navigateBack}
          disabled={!canGoBack || isTransitioning || isFetching}
          className={cn(
            "flex items-center justify-center w-7 h-7 rounded border transition-all shrink-0",
            canGoBack && !isTransitioning && !isFetching
              ? "border-gray-700 hover:border-cyan-600 hover:bg-cyan-950/30 text-gray-400 hover:text-cyan-400 cursor-pointer"
              : "border-gray-800 text-gray-700 cursor-not-allowed"
          )}
          title="Go back"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <span className="text-gray-700">|</span>
        <span className="text-green-500 font-bold">$</span>

        {pathParts.map((p, i) => (
          <div key={i} className="flex items-center gap-1">
            <button
              onClick={() => p.isClickable && navigateToPathIndex(p.index, rootPartsCount)}
              disabled={!p.isClickable || isTransitioning || isFetching}
              className={cn(
                "transition-colors whitespace-nowrap",
                p.isClickable && !isTransitioning && !isFetching
                  ? "hover:text-cyan-400 text-gray-400 cursor-pointer"
                  : "text-white cursor-default font-bold"
              )}
            >
              {p.name}
            </button>
            {i < pathParts.length - 1 && <span className="text-gray-700">/</span>}
          </div>
        ))}
      </div>

      {/* MAIN VISUALIZER */}
      <div
        ref={containerRef}
        className="relative border border-gray-800 bg-[#0a0e14] rounded-lg overflow-hidden"
        style={{ height: isFullscreen ? 'calc(100vh - 280px)' : '550px' }}
      >
        <svg ref={svgRef} className="w-full h-full cursor-crosshair" />

        {/* View Controls - Icons Only */}
        <div className="absolute bottom-3 right-3 flex gap-2">
          <Button
            size="icon"
            variant="outline"
            className="bg-black/80 border-gray-700 w-8 h-8 hover:bg-gray-800 hover:border-cyan-700"
            onClick={resetZoom}
            title="Recenter View"
          >
            <Focus className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="bg-black/80 border-gray-700 w-8 h-8 hover:bg-gray-800 hover:border-cyan-700"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>

        {/* Error State */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <p className="text-red-500 font-bold">Failed to compute Voronoi: {error.toString()}</p>
          </div>
        )}

        {/* Loading State - SINGLE CENTER PANEL WITH PULSE */}
        {(isLoading || isFetching || isTransitioning) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-cyan-950/50 border border-cyan-600 px-6 py-4 rounded-lg flex items-center gap-3 animate-pulse">
              <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <div className="text-cyan-400 font-bold">Loading</div>
            </div>
          </div>
        )}
      </div>

      {/* LEGEND */}
      <div className="flex justify-between items-center text-[10px] uppercase tracking-wider font-mono text-gray-600 px-1">
        <div className="flex gap-4">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: TERMINAL_COLORS.folder, opacity: 0.4 }} />
            Directories
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded border border-dashed" style={{ borderColor: TERMINAL_COLORS.filesContainer, opacity: 0.7 }} />
            Files Region
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: TERMINAL_COLORS.file }} />
            Files
          </span>
        </div>
        <div className="text-gray-700">
          Hover partitions for full info • Click to explore • Drag bubbles
        </div>
      </div>
    </div>
  )
}
