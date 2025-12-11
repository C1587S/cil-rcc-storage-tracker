'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { foldersApi } from '@/lib/api'
import * as d3 from 'd3'
import { Delaunay } from 'd3-delaunay'
// @ts-ignore - d3-voronoi-treemap types may not be available
import { voronoiTreemap } from 'd3-voronoi-treemap'
import { getFileExtension, formatBytes } from '@/lib/utils/formatters'
import { Button } from '@/components/ui/button'
import { Grid3x3, Circle, Hexagon } from 'lucide-react'

type LayoutMode = 'voronoi' | 'circle' | 'rectangular'

interface Node {
  name: string
  size: number
  path: string
  children?: Node[]
  isDirectory: boolean
  file_count?: number
}

interface VoronoiTreemapViewProps {
  path: string
  snapshot: string
}

const CATEGORY_COLORS: Record<string, string> = {
  Code: '#3b82f6',
  Data: '#10b981',
  Document: '#f59e0b',
  System: '#6b7280',
  Archive: '#8b5cf6',
  Image: '#ec4899',
  Video: '#ef4444',
  Directory: '#06b6d4',
  Other: '#64748b',
}

const FILE_TYPE_COLORS: Record<string, { color: string; category: string }> = {
  'py': { color: '#3776ab', category: 'Code' },
  'js': { color: '#f7df1e', category: 'Code' },
  'ts': { color: '#3178c6', category: 'Code' },
  'jsx': { color: '#61dafb', category: 'Code' },
  'tsx': { color: '#61dafb', category: 'Code' },
  'java': { color: '#007396', category: 'Code' },
  'c': { color: '#a8b9cc', category: 'Code' },
  'cpp': { color: '#00599c', category: 'Code' },
  'rs': { color: '#ce422b', category: 'Code' },
  'go': { color: '#00add8', category: 'Code' },
  'csv': { color: '#16a34a', category: 'Data' },
  'json': { color: '#292929', category: 'Data' },
  'xml': { color: '#f97316', category: 'Data' },
  'parquet': { color: '#0ea5e9', category: 'Data' },
  'pdf': { color: '#dc2626', category: 'Document' },
  'docx': { color: '#2563eb', category: 'Document' },
  'txt': { color: '#9ca3af', category: 'Document' },
  'md': { color: '#6b7280', category: 'Document' },
  'log': { color: '#6b7280', category: 'System' },
  'zip': { color: '#7c3aed', category: 'Archive' },
  'tar': { color: '#7c3aed', category: 'Archive' },
  'gz': { color: '#6d28d9', category: 'Archive' },
  'png': { color: '#ec4899', category: 'Image' },
  'jpg': { color: '#db2777', category: 'Image' },
  'svg': { color: '#f472b6', category: 'Image' },
  'mp4': { color: '#ef4444', category: 'Video' },
  'avi': { color: '#dc2626', category: 'Video' },
}

function getNodeColor(name: string, isDirectory: boolean): string {
  if (isDirectory) return CATEGORY_COLORS.Directory

  const ext = getFileExtension(name).toLowerCase()
  const fileInfo = FILE_TYPE_COLORS[ext]

  if (fileInfo) {
    return fileInfo.color
  }

  return CATEGORY_COLORS.Other
}

function transformData(data: any): Node {
  const transform = (node: any): Node => {
    const hasChildren = node.children && Array.isArray(node.children) && node.children.length > 0
    const isDirectory = hasChildren || node.isDirectory || node.is_directory

    const transformed: Node = {
      name: node.name || 'root',
      size: Math.max(node.size || 0, 1), // Ensure minimum size of 1
      path: node.path || '/',
      isDirectory,
      file_count: node.file_count || node.fileCount,
    }

    // Only add children if they exist
    if (hasChildren) {
      transformed.children = node.children.map(transform).filter((child: Node) => child.size > 0)
    }

    return transformed
  }

  const result = transform(data)
  console.log('Transformed data:', {
    name: result.name,
    path: result.path,
    size: result.size,
    childrenCount: result.children?.length || 0,
    hasChildren: !!result.children && result.children.length > 0,
    children: result.children?.map(c => ({ name: c.name, size: c.size }))
  })
  return result
}

export function VoronoiTreemapView({ path, snapshot }: VoronoiTreemapViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('voronoi')
  const [currentNode, setCurrentNode] = useState<Node | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<Node[]>([])

  const { data, isLoading, error } = useQuery({
    queryKey: ['folder-tree-viz', path, snapshot],
    queryFn: () => foldersApi.getTree(path, snapshot),
    enabled: !!snapshot && !!path,
  })

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return

    console.log('Raw data received:', data)
    const transformedData = transformData(data)
    const displayNode = currentNode || transformedData

    console.log('Display node:', displayNode)
    console.log('Display node children count:', displayNode.children?.length || 0)

    const container = containerRef.current
    const width = container.clientWidth
    const height = 600

    if (width === 0) {
      console.warn('Container width is 0, skipping render')
      return
    }

    // Clear previous visualization
    d3.select(svgRef.current).selectAll('*').remove()

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .style('background', '#0f172a')

    const g = svg.append('g')

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })

    svg.call(zoom)

    // Check if we have children to display
    if (!displayNode.children || displayNode.children.length === 0) {
      // Display message when no children
      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#94a3b8')
        .attr('font-size', '14px')
        .text('No subdirectories or files to display')
      return
    }

    if (layoutMode === 'voronoi') {
      renderVoronoiTreemap(g, displayNode, width, height)
    } else if (layoutMode === 'circle') {
      renderCirclePack(g, displayNode, width, height)
    } else {
      renderRectangularTreemap(g, displayNode, width, height)
    }

  }, [data, layoutMode, currentNode])

  const renderVoronoiTreemap = (g: d3.Selection<SVGGElement, unknown, null, undefined>, node: Node, width: number, height: number) => {
    // Create hierarchy
    const hierarchy = d3.hierarchy(node)
      .sum(d => {
        // For leaf nodes (files), use their size
        // For directories, sum will be calculated from children
        if (!d.children || d.children.length === 0) {
          return Math.max(d.size || 1, 1) // Ensure minimum size
        }
        return 0
      })
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    // Add padding to avoid cells touching edges
    const padding = 10
    const clipPolygon = [
      [padding, padding],
      [width - padding, padding],
      [width - padding, height - padding],
      [padding, height - padding]
    ]

    try {
      // Use d3-voronoi-treemap
      const treemapLayout = voronoiTreemap()
        .clip(clipPolygon)
        .convergenceRatio(0.01)
        .maxIterationCount(100)
        .minWeightRatio(0.01)

      // Apply layout
      treemapLayout(hierarchy)

      // Get all nodes with polygons (depth 1 = direct children)
      const nodesWithPolygons = hierarchy.descendants()
        .filter(d => d.depth === 1 && (d as any).polygon)

      console.log('Voronoi nodes with polygons:', nodesWithPolygons.length)

      if (nodesWithPolygons.length === 0) {
        // Fallback to rectangular if Voronoi fails
        console.warn('Voronoi layout failed, using rectangular fallback')
        renderRectangularTreemap(g, node, width, height)
        return
      }

      // Render cells
      g.selectAll('path.voronoi-cell')
        .data(nodesWithPolygons)
        .enter()
        .append('path')
        .attr('class', 'voronoi-cell')
        .attr('d', (d: any) => {
          const polygon = d.polygon
          if (!polygon || polygon.length === 0) return ''
          // Create path from polygon points
          return 'M' + polygon.join('L') + 'Z'
        })
        .attr('fill', d => {
          const nodeData = d.data as Node
          return getNodeColor(nodeData.name, nodeData.isDirectory)
        })
        .attr('fill-opacity', 0.7)
        .attr('stroke', '#1e293b')
        .attr('stroke-width', 2)
        .style('cursor', d => (d.data as Node).isDirectory ? 'pointer' : 'default')
        .on('mouseover', function(event, d) {
          d3.select(this)
            .attr('fill-opacity', 0.9)
            .attr('stroke', '#64748b')
            .attr('stroke-width', 3)

          showTooltip(event, d.data as Node)
        })
        .on('mouseout', function() {
          d3.select(this)
            .attr('fill-opacity', 0.7)
            .attr('stroke', '#1e293b')
            .attr('stroke-width', 2)

          hideTooltip()
        })
        .on('click', (_event, d) => {
          const nodeData = d.data as Node
          if (nodeData.isDirectory && nodeData.children) {
            zoomIntoNode(nodeData)
          }
        })

      // Add labels
      g.selectAll('text.voronoi-label')
        .data(nodesWithPolygons)
        .enter()
        .append('text')
        .attr('class', 'voronoi-label')
        .attr('x', (d: any) => {
          const polygon = d.polygon
          if (!polygon || polygon.length === 0) return 0
          const centroid = d3.polygonCentroid(polygon)
          return centroid[0]
        })
        .attr('y', (d: any) => {
          const polygon = d.polygon
          if (!polygon || polygon.length === 0) return 0
          const centroid = d3.polygonCentroid(polygon)
          return centroid[1]
        })
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#e2e8f0')
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('pointer-events', 'none')
        .text(d => {
          const nodeData = d.data as Node
          const name = nodeData.name
          return name.length > 15 ? name.slice(0, 12) + '...' : name
        })

    } catch (error) {
      console.error('Error rendering Voronoi treemap:', error)
      // Fallback to rectangular layout
      renderRectangularTreemap(g, node, width, height)
    }
  }

  const renderCirclePack = (g: d3.Selection<SVGGElement, unknown, null, undefined>, node: Node, width: number, height: number) => {
    const hierarchy = d3.hierarchy(node)
      .sum(d => d.children ? 0 : (d.size || 1))
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const pack = d3.pack<Node>()
      .size([width, height])
      .padding(5)

    const root = pack(hierarchy)

    const circles = g.selectAll('circle')
      .data(root.descendants().filter(d => d.depth === 1))
      .enter()
      .append('circle')
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
      .attr('r', d => d.r)
      .attr('fill', d => getNodeColor((d.data as Node).name, (d.data as Node).isDirectory))
      .attr('fill-opacity', 0.7)
      .attr('stroke', '#1e293b')
      .attr('stroke-width', 2)
      .style('cursor', d => (d.data as Node).isDirectory ? 'pointer' : 'default')
      .on('mouseover', function(event, d) {
        d3.select(this)
          .attr('fill-opacity', 0.9)
          .attr('stroke', '#64748b')
          .attr('stroke-width', 3)

        showTooltip(event, d.data as Node)
      })
      .on('mouseout', function() {
        d3.select(this)
          .attr('fill-opacity', 0.7)
          .attr('stroke', '#1e293b')
          .attr('stroke-width', 2)

        hideTooltip()
      })
      .on('click', (event, d) => {
        const nodeData = d.data as Node
        if (nodeData.isDirectory && nodeData.children) {
          zoomIntoNode(nodeData)
        }
      })

    g.selectAll('text')
      .data(root.descendants().filter(d => d.depth === 1))
      .enter()
      .append('text')
      .attr('x', d => d.x)
      .attr('y', d => d.y)
      .attr('text-anchor', 'middle')
      .attr('fill', '#e2e8f0')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('pointer-events', 'none')
      .text(d => {
        const name = (d.data as Node).name
        return name.length > 15 ? name.slice(0, 12) + '...' : name
      })
  }

  const renderRectangularTreemap = (g: d3.Selection<SVGGElement, unknown, null, undefined>, node: Node, width: number, height: number) => {
    const hierarchy = d3.hierarchy(node)
      .sum(d => d.children ? 0 : (d.size || 1))
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const treemap = d3.treemap<Node>()
      .size([width, height])
      .padding(2)
      .round(true)

    const root = treemap(hierarchy)

    const rects = g.selectAll('rect')
      .data(root.descendants().filter(d => d.depth === 1))
      .enter()
      .append('rect')
      .attr('x', d => d.x0)
      .attr('y', d => d.y0)
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => d.y1 - d.y0)
      .attr('fill', d => getNodeColor((d.data as Node).name, (d.data as Node).isDirectory))
      .attr('fill-opacity', 0.7)
      .attr('stroke', '#1e293b')
      .attr('stroke-width', 2)
      .attr('rx', 4)
      .style('cursor', d => (d.data as Node).isDirectory ? 'pointer' : 'default')
      .on('mouseover', function(event, d) {
        d3.select(this)
          .attr('fill-opacity', 0.9)
          .attr('stroke', '#64748b')
          .attr('stroke-width', 3)

        showTooltip(event, d.data as Node)
      })
      .on('mouseout', function() {
        d3.select(this)
          .attr('fill-opacity', 0.7)
          .attr('stroke', '#1e293b')
          .attr('stroke-width', 2)

        hideTooltip()
      })
      .on('click', (event, d) => {
        const nodeData = d.data as Node
        if (nodeData.isDirectory && nodeData.children) {
          zoomIntoNode(nodeData)
        }
      })

    g.selectAll('text')
      .data(root.descendants().filter(d => d.depth === 1))
      .enter()
      .append('text')
      .attr('x', d => d.x0 + (d.x1 - d.x0) / 2)
      .attr('y', d => d.y0 + (d.y1 - d.y0) / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#e2e8f0')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('pointer-events', 'none')
      .text(d => {
        const name = (d.data as Node).name
        return name.length > 15 ? name.slice(0, 12) + '...' : name
      })
  }

  const zoomIntoNode = (node: Node) => {
    setBreadcrumbs(prev => [...prev, currentNode || transformData(data)])
    setCurrentNode(node)
  }

  const navigateBack = () => {
    if (breadcrumbs.length === 0) return
    const newBreadcrumbs = [...breadcrumbs]
    const parentNode = newBreadcrumbs.pop()
    setBreadcrumbs(newBreadcrumbs)
    setCurrentNode(parentNode || null)
  }

  const showTooltip = (event: any, node: Node) => {
    const tooltip = d3.select('body')
      .append('div')
      .attr('class', 'voronoi-tooltip')
      .style('position', 'absolute')
      .style('background', '#1e293b')
      .style('border', '1px solid #475569')
      .style('border-radius', '8px')
      .style('padding', '12px')
      .style('color', '#e2e8f0')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('z-index', '1000')
      .style('box-shadow', '0 4px 6px rgba(0, 0, 0, 0.3)')

    tooltip.html(`
      <div style="font-weight: 600; margin-bottom: 8px;">${node.name}</div>
      <div style="color: #94a3b8; margin-bottom: 4px;">Size: ${formatBytes(node.size)}</div>
      ${node.isDirectory ? `<div style="color: #94a3b8;">Files: ${node.file_count?.toLocaleString() || 0}</div>` : ''}
      <div style="color: #64748b; margin-top: 8px; font-size: 10px; max-width: 250px; word-wrap: break-word;">${node.path}</div>
    `)

    tooltip
      .style('left', (event.pageX + 10) + 'px')
      .style('top', (event.pageY - 10) + 'px')
  }

  const hideTooltip = () => {
    d3.selectAll('.voronoi-tooltip').remove()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[600px] text-muted-foreground">
        Loading visualization...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[600px] text-destructive">
        Error loading data
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground">Layout:</span>
          <div className="flex gap-1 border border-border rounded-lg p-1">
            <Button
              variant={layoutMode === 'voronoi' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setLayoutMode('voronoi')}
              className="h-8 px-3"
            >
              <Hexagon className="h-4 w-4 mr-1" />
              Voronoi
            </Button>
            <Button
              variant={layoutMode === 'circle' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setLayoutMode('circle')}
              className="h-8 px-3"
            >
              <Circle className="h-4 w-4 mr-1" />
              Circle
            </Button>
            <Button
              variant={layoutMode === 'rectangular' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setLayoutMode('rectangular')}
              className="h-8 px-3"
            >
              <Grid3x3 className="h-4 w-4 mr-1" />
              Rectangular
            </Button>
          </div>
        </div>

        {breadcrumbs.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={navigateBack}
            className="h-8"
          >
            ← Back
          </Button>
        )}
      </div>

      {currentNode && (
        <div className="text-sm text-muted-foreground">
          Viewing: <span className="font-mono text-foreground">{currentNode.name}</span>
        </div>
      )}

      <div ref={containerRef} className="w-full">
        <svg ref={svgRef} className="rounded-lg" />
      </div>

      <div className="text-xs text-muted-foreground">
        {layoutMode === 'voronoi' && 'Organic cellular layout using Voronoi diagrams'}
        {layoutMode === 'circle' && 'Circular bubble layout with nested packing'}
        {layoutMode === 'rectangular' && 'Classic rectangular treemap layout'}
        {' • '}
        Click directories to zoom in • Drag to pan • Scroll to zoom
      </div>
    </div>
  )
}
