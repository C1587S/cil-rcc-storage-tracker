'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/lib/store'
import { buildVoronoiTree, type VoronoiNode } from '@/lib/voronoi-data-adapter'
import * as d3 from 'd3'
// @ts-ignore - d3-voronoi-treemap types may not be available
import { voronoiTreemap } from 'd3-voronoi-treemap'
import { formatBytes } from '@/lib/utils/formatters'
import { getSizeFillColor } from '@/lib/utils/icon-helpers'
import { Button } from '@/components/ui/button'
import { Maximize2, Minimize2, Focus, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSnapshots } from '@/lib/api'

// Terminal dark theme constants (background, text, borders)
const TERMINAL_COLORS = {
  background: '#0a0e14',
  backgroundLight: '#161b22',
  text: '#c0c0c0',
  textBright: '#ffffff',
  textDim: '#606060',
  border: '#30363d',
  borderBright: '#58a6ff',
}

// Hard-coded quotas (same as Tree view)
const STORAGE_QUOTA_TB = 500;
const FILE_COUNT_QUOTA = 77_000_000;

// Get smooth color gradient for quota bars (10-step scale)
function getQuotaColor(percent: number): string {
  if (percent >= 95) return "bg-red-600/70";        // 95-100%: dark red
  if (percent >= 85) return "bg-red-500/65";        // 85-95%: red
  if (percent >= 75) return "bg-orange-500/65";     // 75-85%: orange
  if (percent >= 65) return "bg-orange-400/60";     // 65-75%: light orange
  if (percent >= 50) return "bg-yellow-400/60";     // 50-65%: yellow
  if (percent >= 35) return "bg-yellow-300/55";     // 35-50%: light yellow
  if (percent >= 25) return "bg-lime-400/55";       // 25-35%: lime
  if (percent >= 15) return "bg-green-400/60";      // 15-25%: light green
  if (percent >= 5) return "bg-green-500/65";       // 5-15%: green
  return "bg-green-600/70";                         // 0-5%: dark green
}

// Get text color for quota percentage (matches bar color scale)
function getQuotaTextColor(percent: number): string {
  if (percent >= 95) return "text-red-600";         // 95-100%: dark red
  if (percent >= 85) return "text-red-500";         // 85-95%: red
  if (percent >= 75) return "text-orange-500";      // 75-85%: orange
  if (percent >= 65) return "text-orange-400";      // 65-75%: light orange
  if (percent >= 50) return "text-yellow-400";      // 50-65%: yellow
  if (percent >= 35) return "text-yellow-300";      // 35-50%: light yellow
  if (percent >= 25) return "text-lime-400";        // 25-35%: lime
  if (percent >= 15) return "text-green-400";       // 15-25%: light green
  if (percent >= 5) return "text-green-500";        // 5-15%: green
  return "text-green-600";                          // 0-5%: dark green
}

/**
 * Recursively apply d3-voronoi-treemap to create hierarchical subdivision
 */
function applyHierarchicalVoronoiTreemap(
  hierarchy: d3.HierarchyNode<VoronoiNode>,
  clipPolygon: [number, number][],
  maxDepth: number = 3
): void {
  const treemapLayout = voronoiTreemap()
    .clip(clipPolygon as any)
    .convergenceRatio(0.01)
    .maxIterationCount(50)
    .minWeightRatio(0.01)

  try {
    treemapLayout(hierarchy)
  } catch (error) {
    console.error('[HierarchicalVoronoi] Layout failed:', error)
    return
  }

  hierarchy.children?.forEach((child) => {
    const childNode = child.data as VoronoiNode
    const childPolygon = (child as any).polygon as [number, number][] | undefined

    if (
      childPolygon &&
      childNode.isDirectory &&
      child.children &&
      child.children.length > 0 &&
      (childNode.depth ?? 0) < maxDepth - 1
    ) {
      applyHierarchicalVoronoiTreemap(child, childPolygon, maxDepth)
    }
  })
}

/**
 * Advanced circle packing using D3 force simulation
 * Returns array of {x, y, r} circles that fit inside the polygon with proper clustering
 */
function packCirclesInPolygon(
  polygon: [number, number][],
  files: Array<{ node: VoronoiNode; value: number }>,
  maxCircles: number = 20
): Array<{ x: number; y: number; r: number; node: VoronoiNode }> {
  if (files.length === 0) return []

  const centroid = d3.polygonCentroid(polygon)
  const area = Math.abs(d3.polygonArea(polygon))

  // Sort files by size (descending) and take top N
  const topFiles = files
    .sort((a, b) => b.value - a.value)
    .slice(0, maxCircles)

  // Total size for scaling
  const totalSize = topFiles.reduce((sum, f) => sum + f.value, 0)

  // Calculate radii with better constraints
  const minR = Math.min(6, Math.sqrt(area) / 50) // Minimum legible radius
  const maxR = Math.sqrt(area / Math.PI) * 0.35

  const circles = topFiles.map((file) => {
    const sizeRatio = file.value / totalSize
    const r = Math.max(
      minR,
      Math.min(
        Math.sqrt(sizeRatio * area / Math.PI) * 0.9,
        maxR
      )
    )
    return {
      x: centroid[0] + (Math.random() - 0.5) * Math.sqrt(area) * 0.3,
      y: centroid[1] + (Math.random() - 0.5) * Math.sqrt(area) * 0.3,
      r,
      node: file.node
    }
  })

  // Apply D3 force simulation for better clustering
  const simulation = d3.forceSimulation(circles as any)
    .force('collision', d3.forceCollide<any>().radius((d: any) => d.r + 1))
    .force('x', d3.forceX(centroid[0]).strength(0.1))
    .force('y', d3.forceY(centroid[1]).strength(0.1))
    .force('center', d3.forceCenter(centroid[0], centroid[1]))
    .stop()

  // Run simulation synchronously
  for (let i = 0; i < 100; i++) {
    simulation.tick()
  }

  // Constrain circles to polygon bounds with better boundary detection
  const bounds = {
    minX: Math.min(...polygon.map(p => p[0])),
    maxX: Math.max(...polygon.map(p => p[0])),
    minY: Math.min(...polygon.map(p => p[1])),
    maxY: Math.max(...polygon.map(p => p[1]))
  }

  return circles.map(circle => ({
    x: Math.max(bounds.minX + circle.r, Math.min(bounds.maxX - circle.r, circle.x)),
    y: Math.max(bounds.minY + circle.r, Math.min(bounds.maxY - circle.r, circle.y)),
    r: circle.r,
    node: circle.node
  }))
}

export function HierarchicalVoronoiView() {
  const {
    selectedSnapshot,
    referencePath,
  } = useAppStore()

  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [currentNode, setCurrentNode] = useState<VoronoiNode | null>(null)
  const [navigationHistory, setNavigationHistory] = useState<Array<{ node: VoronoiNode | null, path: string }>>([])
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [selectedPartition, setSelectedPartition] = useState<VoronoiNode | null>(null)
  const zoomRef = useRef<any>(null)

  // Fetch snapshots for metadata
  const { data: snapshots } = useQuery({
    queryKey: ['snapshots'],
    queryFn: getSnapshots,
  })

  const currentSnapshot = snapshots?.find(s => s.snapshot_date === selectedSnapshot)

  // Eager fetch: Load data in background even before tab is visible
  const { data, isLoading, error } = useQuery({
    queryKey: ['voronoi-tree-hierarchical', selectedSnapshot, referencePath],
    queryFn: () => buildVoronoiTree(selectedSnapshot!, referencePath || '/project/cil', 3, 500),
    enabled: !!selectedSnapshot && !!referencePath,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })

  // Calculate project size from root data
  const projectSize = data ? data.size : 0
  const totalFiles = currentSnapshot?.total_files || 0

  // Calculate quota usage
  const storageTB = projectSize / (1024 ** 4)
  const storageQuotaPercent = (storageTB / STORAGE_QUOTA_TB) * 100
  const fileCountQuotaPercent = (totalFiles / FILE_COUNT_QUOTA) * 100

  // Reset drill-down state when reference path changes
  useEffect(() => {
    setCurrentNode(null)
    setNavigationHistory([])
    setSelectedPartition(null)
  }, [referencePath])

  const zoomIntoNode = useCallback((node: VoronoiNode) => {
    if (isTransitioning || !node.isDirectory) return

    setIsTransitioning(true)

    if (currentNode) {
      setNavigationHistory(prev => [...prev, { node: currentNode, path: currentNode.path }])
    }
    setCurrentNode(node)

    setTimeout(() => setIsTransitioning(false), 600)
  }, [currentNode, isTransitioning])

  const recenterView = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      const svg = d3.select(svgRef.current)
      svg.transition()
        .duration(750)
        .call(zoomRef.current.transform as any, d3.zoomIdentity)
    }
  }, [])

  const toggleFullscreen = useCallback(async () => {
    if (!wrapperRef.current) return

    try {
      if (!isFullscreen) {
        await wrapperRef.current.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    } catch (error) {
      console.error('Fullscreen error:', error)
    }
  }, [isFullscreen])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        toggleFullscreen()
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('keydown', handleEscapeKey)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('keydown', handleEscapeKey)
    }
  }, [isFullscreen, toggleFullscreen])

  const navigateToPathIndex = useCallback((index: number, rootPartsCount: number) => {
    if (isTransitioning) return

    setIsTransitioning(true)

    if (index < rootPartsCount) {
      setNavigationHistory([])
      setCurrentNode(null)
    } else {
      const historyIndex = index - rootPartsCount
      const totalItems = navigationHistory.length + (currentNode ? 1 : 0)
      if (historyIndex === totalItems - 1 && currentNode) {
        setIsTransitioning(false)
        return
      }

      if (historyIndex < navigationHistory.length) {
        setCurrentNode(navigationHistory[historyIndex].node)
        setNavigationHistory(prev => prev.slice(0, historyIndex))
      }
    }

    setTimeout(() => setIsTransitioning(false), 600)
  }, [navigationHistory, currentNode, isTransitioning])

  // Build breadcrumb path parts from navigation history
  const buildBreadcrumbParts = () => {
    const parts: string[] = []
    const rootParts = referencePath === '/' ? ['root'] : referencePath.split('/').filter(Boolean)
    parts.push(...rootParts)

    navigationHistory.forEach(item => {
      if (item.node && item.node.name) {
        parts.push(item.node.name)
      }
    })

    if (currentNode && currentNode.name) {
      parts.push(currentNode.name)
    }

    return { parts, rootPartsCount: rootParts.length }
  }

  const { parts: pathParts, rootPartsCount } = buildBreadcrumbParts()

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current || isTransitioning) return

    const displayNode = currentNode || data

    const container = containerRef.current
    const width = container.clientWidth
    const height = isFullscreen ? window.innerHeight - 300 : 700

    if (width === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    // CRITICAL FIX: SVG container is always 100% width/height
    // Zoom transform is applied to inner <g> element ONLY
    svg
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .style('background', TERMINAL_COLORS.background)

    const g = svg.append('g')

    // CRITICAL FIX: Zoom scale extent starts at 1.0 (no shrinking)
    // This ensures zoom is camera movement, not canvas resizing
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 8])  // Start at 1.0, no shrinking below baseline
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })

    svg.call(zoom)
    zoomRef.current = zoom

    if (!displayNode.children || displayNode.children.length === 0) {
      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', TERMINAL_COLORS.textDim)
        .attr('font-size', '14px')
        .attr('font-family', 'monospace')
        .text('No items to display')
      return
    }

    renderHierarchicalVoronoi(g, displayNode, width, height, zoomIntoNode, setSelectedPartition)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, currentNode, isTransitioning, zoomIntoNode, isFullscreen])

  const renderHierarchicalVoronoi = (
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    node: VoronoiNode,
    width: number,
    height: number,
    onNodeClick: (node: VoronoiNode) => void,
    onPartitionSelect: (node: VoronoiNode) => void
  ) => {
    const padding = 20
    const clipPolygon: [number, number][] = [
      [padding, padding],
      [width - padding, padding],
      [width - padding, height - padding],
      [padding, height - padding]
    ]

    const hierarchy = d3.hierarchy(node)
      .sum(d => {
        if (!d.children || d.children.length === 0) {
          return Math.max(d.size || 1, 1)
        }
        return 0
      })
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    if (typeof voronoiTreemap !== 'function') {
      console.error('[HierarchicalVoronoi] Library not loaded')
      renderFallback(g, node, width, height, onNodeClick)
      return
    }

    try {
      applyHierarchicalVoronoiTreemap(hierarchy, clipPolygon, 3)

      const allDescendants = hierarchy.descendants()
        .filter(d => (d as any).polygon && d.depth > 0)

      const byDepth = d3.group(allDescendants, d => d.depth)
      const depths = Array.from(byDepth.keys()).sort((a, b) => b - a)

      depths.forEach(depth => {
        const cells = byDepth.get(depth) || []

        cells.forEach((d) => {
          const cellNode = d.data as VoronoiNode
          const polygon = (d as any).polygon

          if (!polygon || polygon.length < 3) return

          const centroid = d3.polygonCentroid(polygon)
          const area = Math.abs(d3.polygonArea(polygon))
          const isLeaf = !cellNode.children || cellNode.children.length === 0
          const isDirectory = cellNode.isDirectory

          // Get semantic color based on size (CRITICAL: replaces hardcoded green)
          const fillColor = getSizeFillColor(cellNode.size)
          const strokeColor = fillColor

          if (isDirectory && !isLeaf) {
            // Folder partition: semantic color based on size
            const path = g.append('path')
              .attr('d', 'M' + polygon.map((p: any) => p.join(',')).join('L') + 'Z')
              .attr('fill', fillColor)
              .attr('fill-opacity', 0.25)
              .attr('stroke', strokeColor)
              .attr('stroke-width', depth === 1 ? 2.5 : 2)
              .attr('stroke-opacity', 0.7)
              .style('cursor', 'pointer')
              .style('transition', 'all 0.2s ease')

            path
              .on('mouseover', function(event) {
                d3.select(this)
                  .attr('fill-opacity', 0.4)
                  .attr('stroke', TERMINAL_COLORS.borderBright)
                  .attr('stroke-width', depth === 1 ? 4.5 : 3.5)
                  .attr('stroke-opacity', 1)
                showTooltip(event, cellNode)
              })
              .on('mouseout', function() {
                d3.select(this)
                  .attr('fill-opacity', 0.25)
                  .attr('stroke', strokeColor)
                  .attr('stroke-width', depth === 1 ? 2.5 : 2)
                  .attr('stroke-opacity', 0.7)
                hideTooltip()
              })
              .on('click', function(event) {
                event.stopPropagation()
                // Set selected partition first, then drill down
                onPartitionSelect(cellNode)
                onNodeClick(cellNode)
              })

            // Extended metadata labels (CRITICAL: no icons)
            if (area > 3000) {
              const fontSize = Math.min(12, Math.sqrt(area) / 15)

              // Name
              g.append('text')
                .attr('x', centroid[0])
                .attr('y', centroid[1] - fontSize * 1.2)
                .attr('text-anchor', 'middle')
                .attr('fill', TERMINAL_COLORS.textBright)
                .attr('font-size', `${fontSize}px`)
                .attr('font-weight', '700')
                .attr('font-family', 'monospace')
                .attr('pointer-events', 'none')
                .attr('stroke', TERMINAL_COLORS.background)
                .attr('stroke-width', 3)
                .attr('paint-order', 'stroke')
                .text(cellNode.name.length > 18 ? cellNode.name.slice(0, 15) + '...' : cellNode.name)

              if (area > 5000) {
                // Size
                g.append('text')
                  .attr('x', centroid[0])
                  .attr('y', centroid[1] - 2)
                  .attr('text-anchor', 'middle')
                  .attr('fill', fillColor)
                  .attr('font-size', `${fontSize * 0.85}px`)
                  .attr('font-family', 'monospace')
                  .attr('pointer-events', 'none')
                  .attr('stroke', TERMINAL_COLORS.background)
                  .attr('stroke-width', 2.5)
                  .attr('paint-order', 'stroke')
                  .text(formatBytes(cellNode.size))

                // % of project (if we have project size)
                if (projectSize > 0) {
                  const percentOfProject = (cellNode.size / projectSize) * 100
                  g.append('text')
                    .attr('x', centroid[0])
                    .attr('y', centroid[1] + fontSize * 0.9)
                    .attr('text-anchor', 'middle')
                    .attr('fill', TERMINAL_COLORS.text)
                    .attr('font-size', `${fontSize * 0.75}px`)
                    .attr('font-family', 'monospace')
                    .attr('pointer-events', 'none')
                    .attr('stroke', TERMINAL_COLORS.background)
                    .attr('stroke-width', 2)
                    .attr('paint-order', 'stroke')
                    .text(`${percentOfProject.toFixed(1)}% of project`)
                }

                // % of quota
                if (area > 8000) {
                  const percentOfQuota = (cellNode.size / (STORAGE_QUOTA_TB * 1024 ** 4)) * 100
                  g.append('text')
                    .attr('x', centroid[0])
                    .attr('y', centroid[1] + fontSize * 1.8)
                    .attr('text-anchor', 'middle')
                    .attr('fill', TERMINAL_COLORS.textDim)
                    .attr('font-size', `${fontSize * 0.7}px`)
                    .attr('font-family', 'monospace')
                    .attr('pointer-events', 'none')
                    .attr('stroke', TERMINAL_COLORS.background)
                    .attr('stroke-width', 2)
                    .attr('paint-order', 'stroke')
                    .text(`${percentOfQuota.toFixed(2)}% quota`)
                }

                // File count (if available)
                if (cellNode.file_count && area > 10000) {
                  const filePercent = (cellNode.file_count / FILE_COUNT_QUOTA) * 100
                  g.append('text')
                    .attr('x', centroid[0])
                    .attr('y', centroid[1] + fontSize * 2.7)
                    .attr('text-anchor', 'middle')
                    .attr('fill', TERMINAL_COLORS.textDim)
                    .attr('font-size', `${fontSize * 0.7}px`)
                    .attr('font-family', 'monospace')
                    .attr('pointer-events', 'none')
                    .attr('stroke', TERMINAL_COLORS.background)
                    .attr('stroke-width', 2)
                    .attr('paint-order', 'stroke')
                    .text(`${cellNode.file_count.toLocaleString()} files (${filePercent.toFixed(2)}%)`)
                }
              }
            }

            // CRITICAL FIX: Only show file bubbles for direct children of displayNode (depth === 1)
            // This means bubbles appear ONLY when user has explicitly drilled into a folder
            // Not for all folders at all subdivision depths
            if (depth === 1 && area > 5000 && cellNode.children) {
              const files = cellNode.children.filter(child => !child.isDirectory)
              if (files.length > 0) {
                const fileData = files.map(file => ({
                  node: file,
                  value: file.size
                }))

                const circles = packCirclesInPolygon(polygon, fileData, 15)

                circles.forEach(circle => {
                  const fileColor = getSizeFillColor(circle.node.size)

                  // Draw circle
                  g.append('circle')
                    .attr('cx', circle.x)
                    .attr('cy', circle.y)
                    .attr('r', circle.r)
                    .attr('fill', fileColor)
                    .attr('fill-opacity', 0.5)
                    .attr('stroke', fileColor)
                    .attr('stroke-width', 1.5)
                    .attr('stroke-opacity', 0.8)
                    .style('cursor', 'default')
                    .on('mouseover', function(event) {
                      d3.select(this)
                        .attr('fill-opacity', 0.7)
                        .attr('stroke-width', 2.5)
                      showTooltip(event, circle.node)
                    })
                    .on('mouseout', function() {
                      d3.select(this)
                        .attr('fill-opacity', 0.5)
                        .attr('stroke-width', 1.5)
                      hideTooltip()
                    })
                })
              }
            }
          } else if (!isDirectory) {
            // File partition: semantic color based on size
            const fileColor = getSizeFillColor(cellNode.size)

            g.append('path')
              .attr('d', 'M' + polygon.map((p: any) => p.join(',')).join('L') + 'Z')
              .attr('fill', fileColor)
              .attr('fill-opacity', 0.3)
              .attr('stroke', fileColor)
              .attr('stroke-width', 1.5)
              .attr('stroke-opacity', 0.7)
              .style('cursor', 'default')
              .on('mouseover', function(event) {
                d3.select(this)
                  .attr('fill-opacity', 0.5)
                  .attr('stroke-width', 2.5)
                  .attr('stroke-opacity', 1)
                showTooltip(event, cellNode)
              })
              .on('mouseout', function() {
                d3.select(this)
                  .attr('fill-opacity', 0.3)
                  .attr('stroke-width', 1.5)
                  .attr('stroke-opacity', 0.7)
                hideTooltip()
              })

            // Label for files (no icons)
            if (area > 1500) {
              const fontSize = Math.min(10, Math.sqrt(area) / 18)

              g.append('text')
                .attr('x', centroid[0])
                .attr('y', centroid[1] - 2)
                .attr('text-anchor', 'middle')
                .attr('fill', TERMINAL_COLORS.textBright)
                .attr('font-size', `${fontSize}px`)
                .attr('font-weight', '600')
                .attr('font-family', 'monospace')
                .attr('pointer-events', 'none')
                .attr('stroke', TERMINAL_COLORS.background)
                .attr('stroke-width', 2.5)
                .attr('paint-order', 'stroke')
                .text(cellNode.name.length > 20 ? cellNode.name.slice(0, 17) + '...' : cellNode.name)

              if (area > 2500) {
                g.append('text')
                  .attr('x', centroid[0])
                  .attr('y', centroid[1] + fontSize + 2)
                  .attr('text-anchor', 'middle')
                  .attr('fill', fileColor)
                  .attr('font-size', `${fontSize * 0.8}px`)
                  .attr('font-family', 'monospace')
                  .attr('pointer-events', 'none')
                  .attr('stroke', TERMINAL_COLORS.background)
                  .attr('stroke-width', 2)
                  .attr('paint-order', 'stroke')
                  .text(formatBytes(cellNode.size))
              }
            }
          }
        })
      })

    } catch (error) {
      console.error('[HierarchicalVoronoi] Error:', error)
      renderFallback(g, node, width, height, onNodeClick)
    }
  }

  const renderFallback = (
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    node: VoronoiNode,
    width: number,
    height: number,
    onNodeClick: (node: VoronoiNode) => void
  ) => {
    const hierarchy = d3.hierarchy(node)
      .sum(d => !d.children || d.children.length === 0 ? Math.max(d.size || 1, 1) : 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const treemapLayout = d3.treemap<VoronoiNode>()
      .size([width - 40, height - 40])
      .paddingOuter(20)
      .paddingInner(4)
      .round(true)

    const root = treemapLayout(hierarchy)

    root.descendants().filter(d => d.depth > 0).forEach((d) => {
      const cellNode = d.data as VoronoiNode
      const color = getSizeFillColor(cellNode.size)

      g.append('rect')
        .attr('x', d.x0 + 20)
        .attr('y', d.y0 + 20)
        .attr('width', d.x1 - d.x0)
        .attr('height', d.y1 - d.y0)
        .attr('fill', color)
        .attr('fill-opacity', cellNode.isDirectory ? 0.25 : 0.3)
        .attr('stroke', color)
        .attr('stroke-width', 2)
        .attr('rx', 2)
        .style('cursor', cellNode.isDirectory ? 'pointer' : 'default')
        .on('mouseover', function(event) {
          showTooltip(event, cellNode)
        })
        .on('mouseout', hideTooltip)
        .on('click', function(event) {
          if (cellNode.isDirectory) {
            event.stopPropagation()
            onNodeClick(cellNode)
          }
        })
    })
  }

  const showTooltip = (event: any, node: VoronoiNode) => {
    d3.selectAll('.custom-tooltip').remove()

    const tooltip = d3.select('body')
      .append('div')
      .attr('class', 'custom-tooltip')
      .style('position', 'absolute')
      .style('background', TERMINAL_COLORS.backgroundLight)
      .style('border', `1px solid ${TERMINAL_COLORS.border}`)
      .style('border-radius', '4px')
      .style('padding', '12px')
      .style('color', TERMINAL_COLORS.text)
      .style('font-size', '12px')
      .style('font-family', 'monospace')
      .style('pointer-events', 'none')
      .style('z-index', '10000')
      .style('box-shadow', '0 4px 12px rgba(0, 0, 0, 0.5)')
      .style('max-width', '300px')

    const typeLabel = node.isDirectory ? 'DIR' : 'FILE'
    const sizeColor = getSizeFillColor(node.size)

    tooltip.html(`
      <div style="margin-bottom: 8px; font-weight: 600; color: ${TERMINAL_COLORS.textBright};">
        ${node.name}
      </div>
      <div style="color: ${TERMINAL_COLORS.textDim}; margin-bottom: 4px; font-size: 11px;">
        Type: ${typeLabel}
      </div>
      <div style="color: ${TERMINAL_COLORS.textDim}; margin-bottom: 4px;">
        Size: <span style="color: ${sizeColor};">${formatBytes(node.size)}</span>
      </div>
      ${node.isDirectory && node.file_count ? `
        <div style="color: ${TERMINAL_COLORS.textDim}; margin-bottom: 4px;">
          Files: <span style="color: ${TERMINAL_COLORS.text};">${node.file_count.toLocaleString()}</span>
        </div>
      ` : ''}
      <div style="color: ${TERMINAL_COLORS.textDim}; margin-top: 8px; font-size: 10px; word-wrap: break-word;">
        ${node.path}
      </div>
    `)

    tooltip
      .style('left', (event.pageX + 15) + 'px')
      .style('top', (event.pageY - 15) + 'px')
      .style('opacity', 0)
      .transition()
      .duration(150)
      .style('opacity', 1)
  }

  const hideTooltip = () => {
    d3.selectAll('.custom-tooltip')
      .transition()
      .duration(100)
      .style('opacity', 0)
      .remove()
  }

  if (!selectedSnapshot) {
    return (
      <div className="flex items-center justify-center h-[700px]" style={{ background: TERMINAL_COLORS.background }}>
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold font-mono" style={{ color: TERMINAL_COLORS.text }}>
            No snapshot selected
          </p>
          <p className="text-sm font-mono" style={{ color: TERMINAL_COLORS.textDim }}>
            Please select a snapshot from the dropdown above
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[700px]" style={{ background: TERMINAL_COLORS.background }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin"
               style={{ borderColor: '#4ade80', borderTopColor: 'transparent' }} />
          <p className="text-sm font-mono" style={{ color: TERMINAL_COLORS.textDim }}>
            Loading visualization...
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[700px]" style={{ background: TERMINAL_COLORS.background }}>
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold font-mono" style={{ color: '#ef4444' }}>
            Error loading data
          </p>
          <p className="text-sm font-mono" style={{ color: TERMINAL_COLORS.textDim }}>
            {error.toString()}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className={`space-y-4 ${isFullscreen ? 'p-6 bg-[#0a0e14]' : ''}`}>
      {/* Quota indicators (same as Tree view) */}
      <div className="border-b border-border/50 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Hierarchical Voronoi Treemap</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {selectedSnapshot}
              {referencePath && (
                <span className="ml-2 text-green-500/70">
                  · ref: {referencePath.split('/').pop()}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          {/* Storage quota */}
          <div className="flex items-center gap-2 min-w-[240px]">
            <span className="text-muted-foreground/70 font-mono">Storage:</span>
            <div className="flex-1 h-2 bg-muted/20 rounded-sm overflow-hidden border border-border/30">
              <div
                className={cn(
                  "h-full transition-all",
                  getQuotaColor(storageQuotaPercent)
                )}
                style={{ width: `${Math.min(storageQuotaPercent, 100)}%` }}
              />
            </div>
            <span className="font-mono text-muted-foreground/80 min-w-[110px]">
              {storageTB.toFixed(1)} / {STORAGE_QUOTA_TB} TB
            </span>
            <span className={cn(
              "font-mono font-medium min-w-[42px] text-right",
              getQuotaTextColor(storageQuotaPercent)
            )}>
              ({storageQuotaPercent.toFixed(1)}%)
            </span>
          </div>

          {/* File count quota */}
          <div className="flex items-center gap-2 min-w-[240px]">
            <span className="text-muted-foreground/70 font-mono">Files:</span>
            <div className="flex-1 h-2 bg-muted/20 rounded-sm overflow-hidden border border-border/30">
              <div
                className={cn(
                  "h-full transition-all",
                  getQuotaColor(fileCountQuotaPercent)
                )}
                style={{ width: `${Math.min(fileCountQuotaPercent, 100)}%` }}
              />
            </div>
            <span className="font-mono text-muted-foreground/80 min-w-[110px]">
              {totalFiles.toLocaleString()} / {FILE_COUNT_QUOTA.toLocaleString()}
            </span>
            <span className={cn(
              "font-mono font-medium min-w-[42px] text-right",
              getQuotaTextColor(fileCountQuotaPercent)
            )}>
              ({fileCountQuotaPercent.toFixed(1)}%)
            </span>
          </div>
        </div>
      </div>

      {/* Selected Partition info panel (CRITICAL: Shows clicked partition, not global reference) */}
      <div className="flex justify-end">
        <div className="w-[280px] bg-muted/20 border-2 border-cyan-500/40 rounded-md p-3">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border/30">
            <Target className="w-3.5 h-3.5 text-cyan-500/70" />
            <h4 className="text-xs font-semibold text-cyan-500/90">Selected Partition</h4>
          </div>

          {selectedPartition ? (
            <div className="space-y-1.5 text-[10px] font-mono">
              <div className="flex justify-between items-start">
                <span className="text-muted-foreground/70">Path:</span>
                <span className="text-foreground/80 text-right break-all ml-2" title={selectedPartition.path}>
                  {selectedPartition.path}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground/70">Size:</span>
                <span className="text-foreground/80">
                  {formatBytes(selectedPartition.size)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground/70">% of Project:</span>
                <span className={cn(
                  "font-medium",
                  getSizeFillColor(selectedPartition.size)
                )}>
                  {projectSize > 0 ? ((selectedPartition.size / projectSize) * 100).toFixed(2) : "—"}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground/70">% of Quota:</span>
                <span className={cn(
                  "font-medium",
                  (selectedPartition.size / (STORAGE_QUOTA_TB * 1024 ** 4) * 100) > 10 ? "text-orange-400" :
                  (selectedPartition.size / (STORAGE_QUOTA_TB * 1024 ** 4) * 100) > 5 ? "text-yellow-400" :
                  "text-green-400"
                )}>
                  {((selectedPartition.size / (STORAGE_QUOTA_TB * 1024 ** 4)) * 100).toFixed(2)}%
                </span>
              </div>
              {selectedPartition.file_count && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground/70">Files:</span>
                  <span className="text-foreground/80">
                    {selectedPartition.file_count.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[10px] font-mono text-muted-foreground/50 text-center py-4">
              Click a partition to select
            </div>
          )}
        </div>
      </div>

      {/* Breadcrumb navigation */}
      <div className="flex items-center gap-2 text-sm font-mono" style={{ color: TERMINAL_COLORS.textDim }}>
        <span className="text-xs uppercase tracking-wider">$</span>
        <div className="flex items-center gap-1 px-3 py-1.5 rounded" style={{ background: TERMINAL_COLORS.backgroundLight }}>
          {pathParts.map((part, index) => (
            <span key={index} className="flex items-center">
              {index > 0 && <span className="mx-1" style={{ color: TERMINAL_COLORS.textDim }}>/</span>}
              <button
                onClick={() => navigateToPathIndex(index, rootPartsCount)}
                disabled={index === pathParts.length - 1 || isTransitioning}
                className="transition-all hover:underline disabled:cursor-default"
                style={{
                  color: index === pathParts.length - 1 ? '#4ade80' : TERMINAL_COLORS.textDim,
                  cursor: index === pathParts.length - 1 ? 'default' : 'pointer',
                  textDecoration: index === pathParts.length - 1 ? 'underline' : 'none',
                  textDecorationColor: '#4ade80',
                  textDecorationThickness: '2px',
                  textUnderlineOffset: '4px'
                }}
              >
                {part}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={recenterView}
            disabled={isTransitioning}
            className="h-9 px-3 font-mono"
            style={{
              borderColor: TERMINAL_COLORS.border,
              color: TERMINAL_COLORS.text,
              background: TERMINAL_COLORS.backgroundLight
            }}
            title="Recenter view"
          >
            <Focus className="h-4 w-4 mr-2" />
            Recenter
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={toggleFullscreen}
            className="h-9 px-3 font-mono"
            style={{
              borderColor: TERMINAL_COLORS.border,
              color: TERMINAL_COLORS.text,
              background: TERMINAL_COLORS.backgroundLight
            }}
            title={isFullscreen ? 'Exit fullscreen (ESC)' : 'Enter fullscreen'}
          >
            {isFullscreen ? (
              <><Minimize2 className="h-4 w-4 mr-2" />Exit</>
            ) : (
              <><Maximize2 className="h-4 w-4 mr-2" />Fullscreen</>
            )}
          </Button>
        </div>
      </div>

      {/* Visualization container - CRITICAL: SVG always fills container, zoom transforms inner <g> */}
      <div ref={containerRef} className="w-full rounded overflow-hidden border"
           style={{
             borderColor: TERMINAL_COLORS.border,
             height: isFullscreen ? `${window.innerHeight - 300}px` : '700px'
           }}>
        <svg ref={svgRef} className="rounded w-full h-full" />
      </div>

      {/* Legend - CRITICAL: Clear explanation of semantic color scale */}
      <div className="grid grid-cols-2 gap-4 text-xs font-mono p-4 rounded"
           style={{ color: TERMINAL_COLORS.textDim, background: TERMINAL_COLORS.backgroundLight }}>
        <div>
          <p className="font-semibold mb-2" style={{ color: TERMINAL_COLORS.text }}>Visualization</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border rounded" style={{ borderColor: '#4ade80', background: '#4ade8040' }} />
              <span>Directories (polygons, clickable)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full border" style={{ borderColor: '#facc15', background: '#facc1580' }} />
              <span>Files (bubbles in explored folders)</span>
            </div>
          </div>

          <p className="font-semibold mt-4 mb-2" style={{ color: TERMINAL_COLORS.text }}>Size-Based Color Scale</p>
          <div className="space-y-1 text-[10px]">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ background: '#10b981' }} />
              <span className="text-green-400">Green: Small (10 MB - 1 GB)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ background: '#facc15' }} />
              <span className="text-yellow-400">Yellow: Medium (1 GB - 10 GB)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ background: '#f97316' }} />
              <span className="text-orange-400">Orange: Large (10 GB - 50 GB)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ background: '#ef4444' }} />
              <span className="text-red-400">Red: Very Large (50 GB+)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ background: '#6b7280' }} />
              <span className="text-gray-400">Gray: Negligible (&lt;10 MB)</span>
            </div>
          </div>
        </div>
        <div>
          <p className="font-semibold mb-2" style={{ color: TERMINAL_COLORS.text }}>Controls</p>
          <div className="space-y-1.5">
            <div>• Click directory to drill down</div>
            <div>• Hover for details</div>
            <div>• Scroll to zoom (camera movement)</div>
            <div>• Drag to pan</div>
            <div>• Use breadcrumb to navigate up</div>
          </div>

          <p className="font-semibold mt-4 mb-2" style={{ color: TERMINAL_COLORS.text }}>Behavior</p>
          <div className="space-y-1.5 text-[10px]">
            <div>• Folders show as nested polygons (up to 3 levels)</div>
            <div>• File bubbles appear only in explored folders</div>
            <div>• Click partition to see details in panel above</div>
            <div>• Larger areas = larger sizes (proportional)</div>
          </div>
        </div>
      </div>
    </div>
  )
}
