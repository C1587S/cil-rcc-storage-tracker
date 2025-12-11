'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { foldersApi } from '@/lib/api'
import * as d3 from 'd3'
// @ts-ignore - d3-voronoi-treemap types may not be available
import { voronoiTreemap } from 'd3-voronoi-treemap'
import { getFileExtension, formatBytes } from '@/lib/utils/formatters'
import { Button } from '@/components/ui/button'
import { Maximize2, Minimize2, Focus } from 'lucide-react'

interface Node {
  name: string
  size: number
  path: string
  children?: Node[]
  isDirectory: boolean
  file_count?: number
  depth?: number
}

interface HierarchicalVoronoiViewProps {
  path: string
  snapshot: string
  autoGenerate?: boolean
}

// Terminal color scheme - monochrome with semantic meaning
const TERMINAL_COLORS = {
  background: '#0a0e14',
  backgroundLight: '#161b22',
  folder: '#00ff88ff',      // Green for directories (like ls -la)
  folderDark: '#02631bff',
  file: '#808080',        // Gray for files
  fileBright: '#a0a0a0',
  text: '#c0c0c0',
  textBright: '#ffffff',
  textDim: '#606060',
  border: '#30363d',
  borderBright: '#58a6ff',
  executable: '#ff6b6b', // Red for special files
  archive: '#ffd700',    // Yellow for archives
}

const FILE_TYPE_COLORS: Record<string, string> = {
  // Executables - red
  'sh': TERMINAL_COLORS.executable, 'exe': TERMINAL_COLORS.executable,
  'bin': TERMINAL_COLORS.executable, 'out': TERMINAL_COLORS.executable,

  // Archives - yellow
  'zip': TERMINAL_COLORS.archive, 'tar': TERMINAL_COLORS.archive,
  'gz': TERMINAL_COLORS.archive, 'rar': TERMINAL_COLORS.archive,
  'bz2': TERMINAL_COLORS.archive, '7z': TERMINAL_COLORS.archive,

  // Default - gray
  'default': TERMINAL_COLORS.file
}

/**
 * Transform hierarchical data with depth limiting
 */
function transformData(data: any, maxDepth: number = 3): Node {
  const transform = (node: any, currentDepth: number = 0): Node => {
    const isDirectory = node.is_directory ?? node.isDirectory ?? false
    const hasChildren = isDirectory && node.children && Array.isArray(node.children) && node.children.length > 0

    const transformed: Node = {
      name: node.name || 'root',
      size: Math.max(node.size || 0, 1),
      path: node.path || '/',
      isDirectory,
      file_count: node.file_count || node.fileCount,
      depth: currentDepth,
    }

    if (isDirectory && hasChildren && currentDepth < maxDepth) {
      transformed.children = node.children
        .map((child: any) => transform(child, currentDepth + 1))
        .filter((child: Node) => child.size > 0)
        .sort((a: Node, b: Node) => b.size - a.size)
    }

    return transformed
  }

  return transform(data)
}

/**
 * Get color for file based on extension (terminal style)
 */
function getFileColor(name: string): string {
  const ext = getFileExtension(name).toLowerCase()
  return FILE_TYPE_COLORS[ext] || FILE_TYPE_COLORS['default']
}

/**
 * Recursively apply d3-voronoi-treemap to create hierarchical subdivision
 */
function applyHierarchicalVoronoiTreemap(
  hierarchy: d3.HierarchyNode<Node>,
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
    const childNode = child.data as Node
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

export function HierarchicalVoronoiView({ path, snapshot, autoGenerate = false }: HierarchicalVoronoiViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [currentNode, setCurrentNode] = useState<Node | null>(null)
  const [navigationHistory, setNavigationHistory] = useState<Array<{ node: Node | null, path: string }>>([])
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const zoomRef = useRef<any>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['folder-tree-hierarchical-voronoi', path, snapshot],
    queryFn: () => foldersApi.getTree(path, snapshot),
    enabled: autoGenerate && !!snapshot && !!path,
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    setCurrentNode(null)
    setNavigationHistory([])
  }, [path])

  const zoomIntoNode = useCallback((node: Node) => {
    if (isTransitioning || !node.isDirectory) return

    setIsTransitioning(true)
    // Add current level to history before navigating deeper
    if (currentNode) {
      // We're already at a deeper level, add current node to history
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

    // The breadcrumb is: [root parts...] + [navigation history...] + [current node]
    // Calculate which section this index belongs to

    if (index < rootPartsCount) {
      // Clicking on root path - go back to root
      setNavigationHistory([])
      setCurrentNode(null)
    } else {
      // Clicking on a navigated folder
      // index = rootPartsCount + historyIndex (or rootPartsCount + historyLength for current)
      const historyIndex = index - rootPartsCount

      // If clicking on the last item (currentNode), do nothing
      const totalItems = navigationHistory.length + (currentNode ? 1 : 0)
      if (historyIndex === totalItems - 1 && currentNode) {
        // Already at this level
        setIsTransitioning(false)
        return
      }

      if (historyIndex < navigationHistory.length) {
        // Clicking on a level in history - navigate to that level
        setCurrentNode(navigationHistory[historyIndex].node)
        setNavigationHistory(prev => prev.slice(0, historyIndex))
      }
    }

    setTimeout(() => setIsTransitioning(false), 600)
  }, [navigationHistory, currentNode, isTransitioning, path])

  // Build breadcrumb path parts from navigation history
  const buildBreadcrumbParts = () => {
    const parts: string[] = []

    // Start with root path parts
    const rootParts = path === '/' ? ['root'] : path.split('/').filter(Boolean)
    parts.push(...rootParts)

    // Add navigation history names
    navigationHistory.forEach(item => {
      if (item.node && item.node.name) {
        parts.push(item.node.name)
      }
    })

    // Add current node if it exists
    if (currentNode && currentNode.name) {
      parts.push(currentNode.name)
    }

    return { parts, rootPartsCount: rootParts.length }
  }

  const { parts: pathParts, rootPartsCount } = buildBreadcrumbParts()

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current || isTransitioning) return

    const transformedData = transformData(data, 3)
    const displayNode = currentNode || transformedData

    const container = containerRef.current
    const width = container.clientWidth
    const height = isFullscreen ? window.innerHeight - 200 : 700

    if (width === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    svg
      .attr('width', width)
      .attr('height', height)
      .style('background', TERMINAL_COLORS.background)

    const g = svg.append('g')

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 8])
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

    renderHierarchicalVoronoi(g, displayNode, width, height, zoomIntoNode)

  }, [data, currentNode, isTransitioning, zoomIntoNode, isFullscreen])

  const renderHierarchicalVoronoi = (
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    node: Node,
    width: number,
    height: number,
    onNodeClick: (node: Node) => void
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

      const defs = g.append('defs')

      // Diagonal stripe pattern for files
      const pattern = defs.append('pattern')
        .attr('id', 'file-stripe-pattern')
        .attr('width', 4)
        .attr('height', 4)
        .attr('patternUnits', 'userSpaceOnUse')
        .attr('patternTransform', 'rotate(45)')

      pattern.append('rect')
        .attr('width', 2)
        .attr('height', 4)
        .attr('fill', TERMINAL_COLORS.textDim)
        .attr('opacity', 0.3)

      const allDescendants = hierarchy.descendants()
        .filter(d => (d as any).polygon && d.depth > 0)

      const byDepth = d3.group(allDescendants, d => d.depth)
      const depths = Array.from(byDepth.keys()).sort((a, b) => b - a)

      depths.forEach(depth => {
        const cells = byDepth.get(depth) || []

        cells.forEach((d) => {
          const cellNode = d.data as Node
          const polygon = (d as any).polygon

          if (!polygon || polygon.length < 3) return

          const centroid = d3.polygonCentroid(polygon)
          const area = Math.abs(d3.polygonArea(polygon))
          const isLeaf = !cellNode.children || cellNode.children.length === 0
          const isDirectory = cellNode.isDirectory

          if (isDirectory && !isLeaf) {
            // Folder: green with darker border and reduced transparency
            const path = g.append('path')
              .attr('d', 'M' + polygon.map((p: any) => p.join(',')).join('L') + 'Z')
              .attr('fill', TERMINAL_COLORS.folder)
              .attr('fill-opacity', 0.25)
              .attr('stroke', TERMINAL_COLORS.folder)
              .attr('stroke-width', depth === 1 ? 2.5 : 2)
              .attr('stroke-opacity', 0.7)
              .style('cursor', 'pointer')
              .style('transition', 'all 0.2s ease')

            path
              .on('mouseover', function(event) {
                d3.select(this)
                  .attr('fill-opacity', 0.35)
                  .attr('stroke', TERMINAL_COLORS.borderBright)
                  .attr('stroke-width', depth === 1 ? 4.5 : 3.5)
                  .attr('stroke-opacity', 1)
                showTooltip(event, cellNode)
              })
              .on('mouseout', function() {
                d3.select(this)
                  .attr('fill-opacity', 0.25)
                  .attr('stroke', TERMINAL_COLORS.folder)
                  .attr('stroke-width', depth === 1 ? 2.5 : 2)
                  .attr('stroke-opacity', 0.7)
                hideTooltip()
              })
              .on('click', function(event) {
                event.stopPropagation()
                onNodeClick(cellNode)
              })

            // Label for folders
            if (area > 2000) {
              const fontSize = Math.min(12, Math.sqrt(area) / 15)

              // Add text background for better contrast
              g.append('text')
                .attr('x', centroid[0])
                .attr('y', centroid[1] - 4)
                .attr('text-anchor', 'middle')
                .attr('fill', TERMINAL_COLORS.textBright)
                .attr('font-size', `${fontSize}px`)
                .attr('font-weight', '700')
                .attr('font-family', 'monospace')
                .attr('pointer-events', 'none')
                .attr('stroke', TERMINAL_COLORS.background)
                .attr('stroke-width', 3)
                .attr('paint-order', 'stroke')
                .text('📁 ' + (cellNode.name.length > 18 ? cellNode.name.slice(0, 15) + '...' : cellNode.name))

              if (area > 4000) {
                g.append('text')
                  .attr('x', centroid[0])
                  .attr('y', centroid[1] + fontSize)
                  .attr('text-anchor', 'middle')
                  .attr('fill', TERMINAL_COLORS.folder)
                  .attr('font-size', `${fontSize * 0.85}px`)
                  .attr('font-family', 'monospace')
                  .attr('pointer-events', 'none')
                  .attr('stroke', TERMINAL_COLORS.background)
                  .attr('stroke-width', 2.5)
                  .attr('paint-order', 'stroke')
                  .text(formatBytes(cellNode.size))
              }
            }
          } else {
            // File: patterned with colored stroke based on type
            const fileColor = getFileColor(cellNode.name)

            g.append('path')
              .attr('d', 'M' + polygon.map((p: any) => p.join(',')).join('L') + 'Z')
              .attr('fill', 'url(#file-stripe-pattern)')
              .attr('stroke', fileColor)
              .attr('stroke-width', 1.5)
              .attr('stroke-opacity', 0.7)
              .style('cursor', 'default')
              .style('transition', 'all 0.2s ease')
              .on('mouseover', function(event) {
                d3.select(this)
                  .attr('stroke-width', 2.5)
                  .attr('stroke-opacity', 1)
                showTooltip(event, cellNode)
              })
              .on('mouseout', function() {
                d3.select(this)
                  .attr('stroke-width', 1.5)
                  .attr('stroke-opacity', 0.7)
                hideTooltip()
              })

            // Label for files (show if area is sufficient)
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
                  .attr('fill', TERMINAL_COLORS.text)
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
    node: Node,
    width: number,
    height: number,
    onNodeClick: (node: Node) => void
  ) => {
    const hierarchy = d3.hierarchy(node)
      .sum(d => !d.children || d.children.length === 0 ? Math.max(d.size || 1, 1) : 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const treemapLayout = d3.treemap<Node>()
      .size([width - 40, height - 40])
      .paddingOuter(20)
      .paddingInner(4)
      .round(true)

    const root = treemapLayout(hierarchy)

    root.descendants().filter(d => d.depth > 0).forEach((d) => {
      const cellNode = d.data as Node
      const color = cellNode.isDirectory ? TERMINAL_COLORS.folder : getFileColor(cellNode.name)

      g.append('rect')
        .attr('x', d.x0 + 20)
        .attr('y', d.y0 + 20)
        .attr('width', d.x1 - d.x0)
        .attr('height', d.y1 - d.y0)
        .attr('fill', color)
        .attr('fill-opacity', cellNode.isDirectory ? 0.2 : 0.1)
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

  const showTooltip = (event: any, node: Node) => {
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

    const typeIcon = node.isDirectory ? '📁' : '📄'
    const typeLabel = node.isDirectory ? 'DIR' : 'FILE'

    tooltip.html(`
      <div style="margin-bottom: 8px; font-weight: 600; color: ${TERMINAL_COLORS.textBright};">
        ${typeIcon} ${node.name}
      </div>
      <div style="color: ${TERMINAL_COLORS.textDim}; margin-bottom: 4px; font-size: 11px;">
        Type: ${typeLabel}
      </div>
      <div style="color: ${TERMINAL_COLORS.textDim}; margin-bottom: 4px;">
        Size: <span style="color: ${TERMINAL_COLORS.archive};">${formatBytes(node.size)}</span>
      </div>
      ${node.isDirectory && node.file_count ? `
        <div style="color: ${TERMINAL_COLORS.textDim}; margin-bottom: 4px;">
          Files: <span style="color: ${TERMINAL_COLORS.folder};">${node.file_count.toLocaleString()}</span>
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[700px]" style={{ background: TERMINAL_COLORS.background }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin"
               style={{ borderColor: TERMINAL_COLORS.folder, borderTopColor: 'transparent' }} />
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
          <p className="text-lg font-semibold font-mono" style={{ color: TERMINAL_COLORS.executable }}>
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
                  color: index === pathParts.length - 1 ? TERMINAL_COLORS.folder : TERMINAL_COLORS.textDim,
                  cursor: index === pathParts.length - 1 ? 'default' : 'pointer',
                  textDecoration: index === pathParts.length - 1 ? 'underline' : 'none',
                  textDecorationColor: TERMINAL_COLORS.folder,
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

      <div ref={containerRef} className="w-full rounded overflow-hidden border"
           style={{ borderColor: TERMINAL_COLORS.border }}>
        <svg ref={svgRef} className="rounded" />
      </div>

      <div className="grid grid-cols-2 gap-4 text-xs font-mono p-4 rounded"
           style={{ color: TERMINAL_COLORS.textDim, background: TERMINAL_COLORS.backgroundLight }}>
        <div>
          <p className="font-semibold mb-2" style={{ color: TERMINAL_COLORS.text }}>Legend</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border rounded" style={{ borderColor: TERMINAL_COLORS.folder, background: `${TERMINAL_COLORS.folder}20` }} />
              <span>📁 Directories (green, clickable)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border rounded" style={{ borderColor: TERMINAL_COLORS.file, background: 'url(#file-stripe-pattern)' }} />
              <span>📄 Files (patterned, gray)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border rounded" style={{ borderColor: TERMINAL_COLORS.executable }} />
              <span>Executables (red border)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border rounded" style={{ borderColor: TERMINAL_COLORS.archive }} />
              <span>Archives (yellow border)</span>
            </div>
          </div>
        </div>
        <div>
          <p className="font-semibold mb-2" style={{ color: TERMINAL_COLORS.text }}>Controls</p>
          <div className="space-y-1.5">
            <div>• Click directory to navigate</div>
            <div>• Hover for details</div>
            <div>• Scroll to zoom</div>
            <div>• Drag to pan</div>
          </div>
        </div>
      </div>
    </div>
  )
}
