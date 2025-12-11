'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { foldersApi } from '@/lib/api'
import * as d3 from 'd3'
// @ts-ignore - d3-voronoi-treemap types may not be available
import { voronoiTreemap } from 'd3-voronoi-treemap'
import { getFileExtension, formatBytes } from '@/lib/utils/formatters'
import { Button } from '@/components/ui/button'
import { Home, ChevronLeft } from 'lucide-react'

interface Node {
  name: string
  size: number
  path: string
  children?: Node[]
  isDirectory: boolean
  file_count?: number
  depth?: number
}

interface VoronoiTreemapViewProps {
  path: string
  snapshot: string
}

// Artistic color palette with semantic meaning
const DIRECTORY_PALETTE = [
  { base: '#6366f1', lighter: '#a5b4fc', name: 'Indigo' },
  { base: '#8b5cf6', lighter: '#c4b5fd', name: 'Violet' },
  { base: '#ec4899', lighter: '#f9a8d4', name: 'Pink' },
  { base: '#f59e0b', lighter: '#fcd34d', name: 'Amber' },
  { base: '#10b981', lighter: '#6ee7b7', name: 'Emerald' },
  { base: '#06b6d4', lighter: '#67e8f9', name: 'Cyan' },
  { base: '#f97316', lighter: '#fdba74', name: 'Orange' },
  { base: '#ef4444', lighter: '#fca5a5', name: 'Red' },
  { base: '#14b8a6', lighter: '#5eead4', name: 'Teal' },
  { base: '#a855f7', lighter: '#d8b4fe', name: 'Purple' },
]

const FILE_TYPE_COLORS: Record<string, string> = {
  'py': '#3b82f6', 'js': '#f59e0b', 'ts': '#3b82f6', 'jsx': '#06b6d4',
  'tsx': '#06b6d4', 'java': '#f97316', 'c': '#6b7280', 'cpp': '#6366f1',
  'rs': '#ef4444', 'go': '#06b6d4', 'rb': '#dc2626', 'php': '#8b5cf6',
  'json': '#10b981', 'xml': '#059669', 'csv': '#34d399', 'yaml': '#10b981',
  'yml': '#10b981', 'toml': '#059669', 'parquet': '#14b8a6', 'db': '#0d9488',
  'pdf': '#f59e0b', 'doc': '#f97316', 'docx': '#f97316', 'txt': '#fbbf24',
  'md': '#fcd34d', 'rst': '#fde68a',
  'png': '#ec4899', 'jpg': '#db2777', 'jpeg': '#db2777', 'gif': '#f472b6',
  'svg': '#ec4899', 'webp': '#f9a8d4', 'mp4': '#dc2626', 'avi': '#b91c1c',
  'zip': '#8b5cf6', 'tar': '#7c3aed', 'gz': '#6d28d9', 'rar': '#a855f7',
  'ini': '#6b7280', 'conf': '#4b5563', 'config': '#6b7280', 'env': '#9ca3af',
}

function getDirectoryColor(index: number, isSubdirectory: boolean = false): string {
  const palette = DIRECTORY_PALETTE[index % DIRECTORY_PALETTE.length]
  return isSubdirectory ? palette.lighter : palette.base
}

function getFileColor(name: string): string {
  const ext = getFileExtension(name).toLowerCase()
  return FILE_TYPE_COLORS[ext] || '#94a3b8'
}

// Transform and limit to 2 hierarchical levels for performance
function transformData(data: any, maxDepth: number = 2): Node {
  const transform = (node: any, currentDepth: number = 0): Node => {
    // Trust the is_directory flag from the backend first
    const isDirectory = node.is_directory ?? node.isDirectory ?? false

    // Debug logging for first two levels
    if (currentDepth <= 1) {
      console.log(`[Voronoi Transform] depth=${currentDepth}, name="${node.name}", is_directory=${node.is_directory}, computed=${isDirectory}, children=${node.children?.length || 0}`)
    }

    // Only check for actual children if it's marked as a directory
    const hasChildren = isDirectory && node.children && Array.isArray(node.children) && node.children.length > 0

    const transformed: Node = {
      name: node.name || 'root',
      size: Math.max(node.size || 0, 1),
      path: node.path || '/',
      isDirectory,
      file_count: node.file_count || node.fileCount,
      depth: currentDepth,
    }

    // Only include children if it's a directory AND has children AND within depth limit
    if (isDirectory && hasChildren && currentDepth < maxDepth) {
      transformed.children = node.children
        .map((child: any) => transform(child, currentDepth + 1))
        .filter((child: Node) => child.size > 0)
        .sort((a, b) => b.size - a.size)
    }

    return transformed
  }

  return transform(data)
}

// Create rhomboid (diamond) path for directories
function createRhomboidPath(polygon: number[][]): string {
  if (!polygon || polygon.length < 4) return ''

  const centroid = d3.polygonCentroid(polygon)
  const avgRadius = Math.sqrt(d3.polygonArea(polygon) / Math.PI)

  // Create diamond shape
  const points = [
    [centroid[0], centroid[1] - avgRadius],
    [centroid[0] + avgRadius * 0.8, centroid[1]],
    [centroid[0], centroid[1] + avgRadius],
    [centroid[0] - avgRadius * 0.8, centroid[1]],
  ]

  return 'M' + points.join('L') + 'Z'
}

// Create hexagon path for files
function createHexagonPath(center: number[], radius: number): string {
  const points = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2
    points.push([
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle)
    ])
  }
  return 'M' + points.join('L') + 'Z'
}

export function VoronoiTreemapView({ path, snapshot }: VoronoiTreemapViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentNode, setCurrentNode] = useState<Node | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>([])
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isActivated, setIsActivated] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['folder-tree-viz', path, snapshot],
    queryFn: () => {
      console.log('[VoronoiTreemapView] Fetching tree data for:', { path, snapshot })
      return foldersApi.getTree(path, snapshot)
    },
    enabled: isActivated && !!snapshot && !!path,
    staleTime: 5 * 60 * 1000,
  })

  // Log data when it arrives
  useEffect(() => {
    if (data) {
      console.log('[VoronoiTreemapView] Received tree data:', {
        path: data.path,
        name: data.name,
        size: data.size,
        is_directory: data.is_directory,
        childrenCount: data.children?.length || 0
      })

      // Log first 5 children to debug is_directory flag
      if (data.children && data.children.length > 0) {
        console.log('[VoronoiTreemapView] First 5 children:', data.children.slice(0, 5).map(c => ({
          name: c.name,
          is_directory: c.is_directory,
          size: c.size,
          childrenCount: c.children?.length || 0
        })))
      }
    }
  }, [data])

  // Reset navigation state and activation when path prop changes (e.g., when user selects different folder in sidebar)
  useEffect(() => {
    setCurrentNode(null)
    setBreadcrumbs([])
    setIsActivated(false)
  }, [path])

  const zoomIntoNode = useCallback((node: Node) => {
    if (isTransitioning) return

    setIsTransitioning(true)
    setBreadcrumbs(prev => [...prev, currentNode?.path || '/'])
    setCurrentNode(node)

    setTimeout(() => setIsTransitioning(false), 600)
  }, [currentNode, isTransitioning])

  const navigateBack = useCallback(() => {
    if (breadcrumbs.length === 0 || isTransitioning) return

    setIsTransitioning(true)
    const newBreadcrumbs = [...breadcrumbs]
    newBreadcrumbs.pop()
    setBreadcrumbs(newBreadcrumbs)
    setCurrentNode(null)

    setTimeout(() => setIsTransitioning(false), 600)
  }, [breadcrumbs, isTransitioning])

  const navigateHome = useCallback(() => {
    if (isTransitioning) return

    setIsTransitioning(true)
    setBreadcrumbs([])
    setCurrentNode(null)

    setTimeout(() => setIsTransitioning(false), 600)
  }, [isTransitioning])

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current || isTransitioning) return

    const transformedData = transformData(data, 2)
    const displayNode = currentNode || transformedData

    const container = containerRef.current
    const width = container.clientWidth
    const height = 700

    if (width === 0) return

    // Clear and setup SVG
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    svg
      .attr('width', width)
      .attr('height', height)
      .style('background', 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)')

    const g = svg.append('g')

    // Smooth zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.8, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })

    svg.call(zoom)

    // Check for children
    if (!displayNode.children || displayNode.children.length === 0) {
      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#94a3b8')
        .attr('font-size', '16px')
        .attr('font-family', 'system-ui, sans-serif')
        .text('No subdirectories or files to display')
      return
    }

    // Render artistic voronoi treemap
    renderArtisticVoronoi(g, displayNode, width, height, zoomIntoNode)

  }, [data, currentNode, isTransitioning, zoomIntoNode])

  const renderArtisticVoronoi = (
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    node: Node,
    width: number,
    height: number,
    onNodeClick: (node: Node) => void
  ) => {
    const hierarchy = d3.hierarchy(node)
      .sum(d => !d.children || d.children.length === 0 ? Math.max(d.size || 1, 1) : 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const padding = 20
    const clipPolygon = [
      [padding, padding],
      [width - padding, padding],
      [width - padding, height - padding],
      [padding, height - padding]
    ]

    try {
      // Check if voronoiTreemap is available
      if (typeof voronoiTreemap !== 'function') {
        console.error('voronoiTreemap is not available')
        throw new Error('Voronoi treemap library not loaded')
      }

      const treemapLayout = voronoiTreemap()
        .clip(clipPolygon)
        .convergenceRatio(0.01)
        .maxIterationCount(100)
        .minWeightRatio(0.01)

      // Apply layout with error handling
      try {
        treemapLayout(hierarchy)
      } catch (layoutError) {
        console.error('Voronoi layout computation failed:', layoutError)
        throw layoutError
      }

      const level1 = hierarchy.descendants().filter(d => d.depth === 1 && (d as any).polygon)
      const level2 = hierarchy.descendants().filter(d => d.depth === 2 && (d as any).polygon)

      console.log('Voronoi layout successful:', { level1Count: level1.length, level2Count: level2.length })

      // Render level 1 (directories) as rhomboids with gradients
      const directoryCells = g.selectAll('path.dir-cell')
        .data(level1.filter(d => (d.data as Node).isDirectory))
        .enter()
        .append('g')
        .attr('class', 'directory-group')

      directoryCells.each(function(d, i) {
        const group = d3.select(this)
        const polygon = (d as any).polygon
        const nodeData = d.data as Node
        const baseColor = getDirectoryColor(i, false)

        // Add gradient definition
        const gradientId = `dir-gradient-${i}`
        const defs = g.append('defs')
        const gradient = defs.append('linearGradient')
          .attr('id', gradientId)
          .attr('x1', '0%')
          .attr('y1', '0%')
          .attr('x2', '100%')
          .attr('y2', '100%')

        gradient.append('stop')
          .attr('offset', '0%')
          .attr('stop-color', baseColor)
          .attr('stop-opacity', 0.9)

        gradient.append('stop')
          .attr('offset', '100%')
          .attr('stop-color', d3.color(baseColor)?.darker(0.5).toString() || baseColor)
          .attr('stop-opacity', 0.8)

        // Create rhomboid path
        const path = group.append('path')
          .attr('class', 'dir-cell')
          .attr('d', 'M' + polygon.join('L') + 'Z')
          .attr('fill', `url(#${gradientId})`)
          .attr('stroke', '#1e293b')
          .attr('stroke-width', 2.5)
          .attr('stroke-opacity', 0.6)
          .style('cursor', 'pointer')
          .style('filter', 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))')
          .style('transition', 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)')

        path
          .on('mouseover', function(event) {
            d3.select(this)
              .attr('stroke', '#94a3b8')
              .attr('stroke-width', 3.5)
              .style('filter', 'drop-shadow(0 8px 24px rgba(0, 0, 0, 0.5))')

            showTooltip(event, nodeData)
          })
          .on('mouseout', function() {
            d3.select(this)
              .attr('stroke', '#1e293b')
              .attr('stroke-width', 2.5)
              .style('filter', 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))')

            hideTooltip()
          })
          .on('click', function(event) {
            event.stopPropagation()
            if (nodeData.children) {
              onNodeClick(nodeData)
            }
          })

        // Add label
        const centroid = d3.polygonCentroid(polygon)
        const area = Math.abs(d3.polygonArea(polygon))

        if (area > 2000) {
          group.append('text')
            .attr('x', centroid[0])
            .attr('y', centroid[1] - 8)
            .attr('text-anchor', 'middle')
            .attr('fill', '#ffffff')
            .attr('font-size', Math.min(16, Math.sqrt(area) / 15) + 'px')
            .attr('font-weight', '700')
            .attr('font-family', 'system-ui, sans-serif')
            .attr('pointer-events', 'none')
            .style('text-shadow', '0 2px 8px rgba(0, 0, 0, 0.8)')
            .text(nodeData.name.length > 20 ? nodeData.name.slice(0, 17) + '...' : nodeData.name)

          group.append('text')
            .attr('x', centroid[0])
            .attr('y', centroid[1] + 10)
            .attr('text-anchor', 'middle')
            .attr('fill', '#e2e8f0')
            .attr('font-size', Math.min(12, Math.sqrt(area) / 20) + 'px')
            .attr('font-family', 'system-ui, sans-serif')
            .attr('pointer-events', 'none')
            .style('text-shadow', '0 2px 8px rgba(0, 0, 0, 0.8)')
            .text(formatBytes(nodeData.size))
        }
      })

      // Render level 2 (subdirectories and files) as smaller shapes
      level2.forEach((d, i) => {
        const polygon = (d as any).polygon
        if (!polygon) return

        const nodeData = d.data as Node

        // Debug logging for level 2 rendering
        console.log(`[Voronoi Render L2] name="${nodeData.name}", isDirectory=${nodeData.isDirectory}, size=${nodeData.size}`)

        const parent = d.parent
        const parentIndex = level1.indexOf(parent!)
        const centroid = d3.polygonCentroid(polygon)
        const area = Math.abs(d3.polygonArea(polygon))
        const radius = Math.sqrt(area / Math.PI) * 0.6

        if (nodeData.isDirectory) {
          // Subdirectories as lighter colored rhomboids
          const color = getDirectoryColor(parentIndex >= 0 ? parentIndex : i, true)

          g.append('path')
            .attr('d', createRhomboidPath(polygon))
            .attr('fill', color)
            .attr('fill-opacity', 0.7)
            .attr('stroke', '#0f172a')
            .attr('stroke-width', 1.5)
            .style('cursor', 'pointer')
            .style('transition', 'all 0.2s ease')
            .on('mouseover', function(event) {
              d3.select(this)
                .attr('fill-opacity', 0.95)
                .attr('stroke-width', 2.5)
              showTooltip(event, nodeData)
            })
            .on('mouseout', function() {
              d3.select(this)
                .attr('fill-opacity', 0.7)
                .attr('stroke-width', 1.5)
              hideTooltip()
            })
            .on('click', function(event) {
              event.stopPropagation()
              if (nodeData.children) {
                onNodeClick(nodeData)
              }
            })
        } else {
          // Files as hexagons - NOT clickable, only show tooltip
          const color = getFileColor(nodeData.name)
          const fileRadius = Math.max(4, Math.min(radius, 20))

          g.append('path')
            .attr('d', createHexagonPath(centroid, fileRadius))
            .attr('fill', color)
            .attr('fill-opacity', 0.85)
            .attr('stroke', '#0f172a')
            .attr('stroke-width', 1)
            .style('cursor', 'default')
            .style('transition', 'all 0.2s ease')
            .on('mouseover', function(event) {
              d3.select(this)
                .attr('fill-opacity', 1)
                .attr('stroke-width', 2)
              showTooltip(event, nodeData)
            })
            .on('mouseout', function() {
              d3.select(this)
                .attr('fill-opacity', 0.85)
                .attr('stroke-width', 1)
              hideTooltip()
            })
            // No click handler for files
        }
      })

    } catch (error) {
      console.error('Voronoi rendering error:', error)
      // Fallback to artistic rectangular treemap
      renderArtisticRectangular(g, node, width, height, onNodeClick)
    }
  }

  const renderArtisticRectangular = (
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

    // Get level 1 and level 2 nodes
    const level1 = root.descendants().filter(d => d.depth === 1)
    const level2 = root.descendants().filter(d => d.depth === 2)

    // Render level 1 (directories) with gradients
    level1.forEach((d, i) => {
      const nodeData = d.data as Node
      if (!nodeData.isDirectory) return

      const baseColor = getDirectoryColor(i, false)
      const group = g.append('g')

      // Create gradient
      const gradientId = `rect-gradient-${i}`
      const defs = g.append('defs')
      const gradient = defs.append('linearGradient')
        .attr('id', gradientId)
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '100%')
        .attr('y2', '100%')

      gradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', baseColor)
        .attr('stop-opacity', 0.9)

      gradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', d3.color(baseColor)?.darker(0.5).toString() || baseColor)
        .attr('stop-opacity', 0.8)

      // Create rounded rectangle with gradient
      group.append('rect')
        .attr('x', d.x0 + 20)
        .attr('y', d.y0 + 20)
        .attr('width', d.x1 - d.x0)
        .attr('height', d.y1 - d.y0)
        .attr('fill', `url(#${gradientId})`)
        .attr('stroke', '#1e293b')
        .attr('stroke-width', 2.5)
        .attr('rx', 8)
        .attr('ry', 8)
        .style('cursor', 'pointer')
        .style('filter', 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))')
        .style('transition', 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)')
        .on('mouseover', function(event) {
          d3.select(this)
            .attr('stroke', '#94a3b8')
            .attr('stroke-width', 3.5)
            .style('filter', 'drop-shadow(0 8px 24px rgba(0, 0, 0, 0.5))')
          showTooltip(event, nodeData)
        })
        .on('mouseout', function() {
          d3.select(this)
            .attr('stroke', '#1e293b')
            .attr('stroke-width', 2.5)
            .style('filter', 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))')
          hideTooltip()
        })
        .on('click', function(event) {
          event.stopPropagation()
          if (nodeData.children) {
            onNodeClick(nodeData)
          }
        })

      // Add label
      const rectWidth = d.x1 - d.x0
      const rectHeight = d.y1 - d.y0
      const area = rectWidth * rectHeight

      if (area > 3000) {
        group.append('text')
          .attr('x', d.x0 + 20 + rectWidth / 2)
          .attr('y', d.y0 + 20 + rectHeight / 2 - 8)
          .attr('text-anchor', 'middle')
          .attr('fill', '#ffffff')
          .attr('font-size', Math.min(16, Math.sqrt(area) / 15) + 'px')
          .attr('font-weight', '700')
          .attr('font-family', 'system-ui, sans-serif')
          .attr('pointer-events', 'none')
          .style('text-shadow', '0 2px 8px rgba(0, 0, 0, 0.8)')
          .text(nodeData.name.length > 20 ? nodeData.name.slice(0, 17) + '...' : nodeData.name)

        group.append('text')
          .attr('x', d.x0 + 20 + rectWidth / 2)
          .attr('y', d.y0 + 20 + rectHeight / 2 + 10)
          .attr('text-anchor', 'middle')
          .attr('fill', '#e2e8f0')
          .attr('font-size', Math.min(12, Math.sqrt(area) / 20) + 'px')
          .attr('font-family', 'system-ui, sans-serif')
          .attr('pointer-events', 'none')
          .style('text-shadow', '0 2px 8px rgba(0, 0, 0, 0.8)')
          .text(formatBytes(nodeData.size))
      }
    })

    // Render level 2 (subdirectories and files)
    level2.forEach((d, i) => {
      const nodeData = d.data as Node
      const parent = d.parent
      const parentIndex = level1.indexOf(parent!)
      const rectWidth = d.x1 - d.x0
      const rectHeight = d.y1 - d.y0
      const area = rectWidth * rectHeight

      if (area < 100) return // Skip very small items

      if (nodeData.isDirectory) {
        // Subdirectories as lighter rounded rectangles
        const color = getDirectoryColor(parentIndex >= 0 ? parentIndex : i, true)

        g.append('rect')
          .attr('x', d.x0 + 20)
          .attr('y', d.y0 + 20)
          .attr('width', rectWidth)
          .attr('height', rectHeight)
          .attr('fill', color)
          .attr('fill-opacity', 0.7)
          .attr('stroke', '#0f172a')
          .attr('stroke-width', 1.5)
          .attr('rx', 4)
          .attr('ry', 4)
          .style('cursor', 'pointer')
          .style('transition', 'all 0.2s ease')
          .on('mouseover', function(event) {
            d3.select(this)
              .attr('fill-opacity', 0.95)
              .attr('stroke-width', 2.5)
            showTooltip(event, nodeData)
          })
          .on('mouseout', function() {
            d3.select(this)
              .attr('fill-opacity', 0.7)
              .attr('stroke-width', 1.5)
            hideTooltip()
          })
          .on('click', function(event) {
            event.stopPropagation()
            if (nodeData.children) {
              onNodeClick(nodeData)
            }
          })
      } else {
        // Files as colored rectangles - NOT clickable, only show tooltip
        const color = getFileColor(nodeData.name)

        g.append('rect')
          .attr('x', d.x0 + 20)
          .attr('y', d.y0 + 20)
          .attr('width', rectWidth)
          .attr('height', rectHeight)
          .attr('fill', color)
          .attr('fill-opacity', 0.85)
          .attr('stroke', '#0f172a')
          .attr('stroke-width', 1)
          .attr('rx', 2)
          .attr('ry', 2)
          .style('cursor', 'default')
          .style('transition', 'all 0.2s ease')
          .on('mouseover', function(event) {
            d3.select(this)
              .attr('fill-opacity', 1)
              .attr('stroke-width', 2)
            showTooltip(event, nodeData)
          })
          .on('mouseout', function() {
            d3.select(this)
              .attr('fill-opacity', 0.85)
              .attr('stroke-width', 1)
            hideTooltip()
          })
          // No click handler for files
      }
    })
  }

  const showTooltip = (event: any, node: Node) => {
    d3.selectAll('.custom-tooltip').remove()

    const tooltip = d3.select('body')
      .append('div')
      .attr('class', 'custom-tooltip')
      .style('position', 'absolute')
      .style('background', 'linear-gradient(135deg, #1e293b 0%, #334155 100%)')
      .style('border', '1px solid #475569')
      .style('border-radius', '12px')
      .style('padding', '16px')
      .style('color', '#f1f5f9')
      .style('font-size', '13px')
      .style('font-family', 'system-ui, sans-serif')
      .style('pointer-events', 'none')
      .style('z-index', '10000')
      .style('box-shadow', '0 20px 40px rgba(0, 0, 0, 0.5)')
      .style('backdrop-filter', 'blur(10px)')
      .style('max-width', '300px')

    tooltip.html(`
      <div style="font-weight: 700; margin-bottom: 10px; font-size: 15px; color: #e2e8f0;">
        ${node.isDirectory ? '📁' : '📄'} ${node.name}
      </div>
      <div style="color: #cbd5e1; margin-bottom: 6px; display: flex; justify-content: space-between;">
        <span>Size:</span>
        <span style="font-weight: 600; color: #fbbf24;">${formatBytes(node.size)}</span>
      </div>
      ${node.isDirectory && node.file_count ? `
        <div style="color: #cbd5e1; margin-bottom: 6px; display: flex; justify-content: space-between;">
          <span>Files:</span>
          <span style="font-weight: 600; color: #60a5fa;">${node.file_count.toLocaleString()}</span>
        </div>
      ` : ''}
      <div style="color: #64748b; margin-top: 10px; font-size: 11px; word-wrap: break-word; font-family: monospace;">
        ${node.path}
      </div>
    `)

    tooltip
      .style('left', (event.pageX + 15) + 'px')
      .style('top', (event.pageY - 15) + 'px')
      .style('opacity', 0)
      .transition()
      .duration(200)
      .style('opacity', 1)
  }

  const hideTooltip = () => {
    d3.selectAll('.custom-tooltip')
      .transition()
      .duration(150)
      .style('opacity', 0)
      .remove()
  }

  // Show activation button if not activated
  if (!isActivated) {
    return (
      <div className="flex items-center justify-center h-[700px]">
        <div className="text-center space-y-4">
          <div className="space-y-2">
            <h3 className="text-xl font-semibold text-foreground">Voronoi Treemap Visualization</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              This artistic visualization renders your file system as an organic cellular structure.
              <br />
              Click below to generate the visualization for the current path.
            </p>
          </div>
          <Button
            size="lg"
            onClick={() => {
              console.log('[VoronoiTreemapView] Activating visualization for path:', path)
              setIsActivated(true)
            }}
            className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white px-8 py-6 text-base font-semibold shadow-lg hover:shadow-xl transition-all"
          >
            Generate Voronoi Visualization
          </Button>
          <p className="text-xs text-muted-foreground font-mono mt-4">
            Current path: {path}
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[700px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground text-sm">Loading visualization...</p>
          <p className="text-xs text-muted-foreground font-mono">Path: {path}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[700px] text-destructive">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold mb-2">Error loading data</p>
          <p className="text-sm text-muted-foreground">Please try refreshing the page</p>
          <p className="text-xs font-mono text-muted-foreground mt-4">Path: {path}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsActivated(false)}
            className="mt-4"
          >
            Reset
          </Button>
        </div>
      </div>
    )
  }

  // Build full path for breadcrumb display
  const displayPath = currentNode ? currentNode.path : path
  const pathParts = displayPath === '/' ? ['root'] : displayPath.split('/').filter(Boolean)

  return (
    <div className="space-y-4">
      {/* Breadcrumb path indicator */}
      <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground">
        <span className="text-xs uppercase tracking-wider">Viewing:</span>
        <div className="flex items-center gap-1 bg-secondary/30 px-3 py-1.5 rounded-md">
          {pathParts.map((part, index) => (
            <span key={index} className="flex items-center">
              {index > 0 && <span className="mx-1 text-muted-foreground/50">/</span>}
              <span className={index === pathParts.length - 1 ? 'text-foreground font-semibold' : 'text-muted-foreground'}>
                {part}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={navigateHome}
            disabled={breadcrumbs.length === 0 || isTransitioning}
            className="h-9 px-3 transition-all"
          >
            <Home className="h-4 w-4 mr-2" />
            Root
          </Button>

          {breadcrumbs.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={navigateBack}
              disabled={isTransitioning}
              className="h-9 px-3 transition-all"
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          )}
        </div>

        <div className="text-sm font-mono text-muted-foreground bg-secondary/50 px-4 py-2 rounded-lg">
          {currentNode ? (
            <>
              <span className="text-foreground font-semibold">{currentNode.name}</span>
              <span className="mx-2">·</span>
              <span className="text-amber-500">{formatBytes(currentNode.size)}</span>
              {currentNode.file_count && (
                <>
                  <span className="mx-2">·</span>
                  <span className="text-blue-400">{currentNode.file_count.toLocaleString()} files</span>
                </>
              )}
            </>
          ) : data ? (
            <>
              <span className="text-foreground font-semibold">{path === '/' ? 'Root' : path.split('/').pop()}</span>
              <span className="mx-2">·</span>
              <span className="text-amber-500">{formatBytes(data.size)}</span>
              {data.file_count && (
                <>
                  <span className="mx-2">·</span>
                  <span className="text-blue-400">{data.file_count.toLocaleString()} files</span>
                </>
              )}
            </>
          ) : null}
        </div>
      </div>

      <div ref={containerRef} className="w-full rounded-xl overflow-hidden shadow-2xl border border-border">
        <svg ref={svgRef} className="rounded-xl" />
      </div>

      <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground bg-secondary/30 p-4 rounded-lg">
        <div>
          <p className="font-semibold text-foreground mb-2">Visual Guide</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-indigo-500 rounded transform rotate-45" />
              <span>Large directories (rhomboids with gradients)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-indigo-300 rounded transform rotate-45" />
              <span>Subdirectories (lighter rhomboids)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-amber-500 rounded-full" style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }} />
              <span>Files (hexagons, size-proportional)</span>
            </div>
          </div>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-2">Interactions</p>
          <div className="space-y-1.5">
            <div>• <strong>Click directory</strong> to zoom into it</div>
            <div>• <strong>Hover</strong> for detailed information</div>
            <div>• <strong>Scroll</strong> to zoom in/out</div>
            <div>• <strong>Drag</strong> to pan around</div>
          </div>
        </div>
      </div>
    </div>
  )
}
