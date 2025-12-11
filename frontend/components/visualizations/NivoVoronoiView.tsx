'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { foldersApi } from '@/lib/api'
import * as d3 from 'd3'
import { Delaunay } from 'd3-delaunay'
import { formatBytes } from '@/lib/utils/formatters'
import { Button } from '@/components/ui/button'

interface Node {
  name: string
  size: number
  path: string
  children?: Node[]
  isDirectory: boolean
  file_count?: number
  x?: number
  y?: number
}

interface NivoVoronoiViewProps {
  path: string
  snapshot: string
  autoGenerate?: boolean
}

export function NivoVoronoiView({ path, snapshot, autoGenerate = false }: NivoVoronoiViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentPath, setCurrentPath] = useState(path)

  // Auto-activate when autoGenerate is true
  useEffect(() => {
    if (autoGenerate) {
      setCurrentPath(path)
    }
  }, [path, autoGenerate])

  const { data, isLoading, error } = useQuery({
    queryKey: ['voronoi-tree', currentPath, snapshot],
    queryFn: () => foldersApi.getTree(currentPath, snapshot, 1), // Only fetch 1 level
    enabled: autoGenerate && !!snapshot && !!currentPath,
    staleTime: 5 * 60 * 1000,
  })

  // Reset to initial path when path prop changes
  useEffect(() => {
    setCurrentPath(path)
  }, [path])

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = 700

    if (width === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    svg
      .attr('width', width)
      .attr('height', height)
      .style('background', '#fafafa')

    const g = svg.append('g')

    // Get only direct children (one level)
    const children = data.children || []

    if (children.length === 0) {
      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#999')
        .text('No subfolders or files to display')
      return
    }

    // Create nodes array with proper structure
    const nodes: Node[] = children.map((child: any) => ({
      name: child.name,
      size: child.size || 1,
      path: child.path,
      isDirectory: child.is_directory || child.isDirectory,
      file_count: child.file_count,
    }))

    // Create circle packing layout for positioning
    const pack = d3.pack<Node>()
      .size([width - 40, height - 40])
      .padding(3)

    const root = d3.hierarchy({ children: nodes } as any)
      .sum(d => (d as Node).size || 1)

    pack(root)

    // Extract positioned nodes with x, y from pack layout
    const positionedNodes = root.leaves().map(d => {
      const packNode = d as d3.HierarchyCircularNode<any>
      return {
        ...(d.data as Node),
        x: packNode.x + 20,
        y: packNode.y + 20,
      }
    })

    // Create Voronoi diagram using d3-delaunay
    const points = positionedNodes.map(d => [d.x!, d.y!] as [number, number])
    const delaunay = Delaunay.from(points)
    const voronoi = delaunay.voronoi([0, 0, width, height])

    // Separate folders and files
    const folders = positionedNodes.filter(n => n.isDirectory)
    const files = positionedNodes.filter(n => !n.isDirectory)

    // Draw Voronoi cells for folders only (they will contain the file squares)
    folders.forEach((node) => {
      const nodeIndex = positionedNodes.indexOf(node)
      const cell = voronoi.cellPolygon(nodeIndex)
      if (!cell) return

      const pathData = `M${cell.map(p => p.join(',')).join('L')}Z`

      g.append('path')
        .attr('d', pathData)
        .attr('fill', '#dbeafe')
        .attr('fill-opacity', 0.2)
        .attr('stroke', '#3b82f6')
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.8)
        .style('cursor', 'pointer')
        .on('mouseover', function(event) {
          d3.select(this)
            .attr('fill-opacity', 0.4)
            .attr('stroke', '#2563eb')
            .attr('stroke-width', 2.5)
            .attr('stroke-opacity', 1)
          showTooltip(event, node)
        })
        .on('mouseout', function() {
          d3.select(this)
            .attr('fill-opacity', 0.2)
            .attr('stroke', '#3b82f6')
            .attr('stroke-width', 2)
            .attr('stroke-opacity', 0.8)
          hideTooltip()
        })
        .on('click', function(event) {
          event.stopPropagation()
          // Drill down into this folder
          setCurrentPath(node.path)
        })

      // Add folder label
      const centroid = d3.polygonCentroid(cell)
      const area = Math.abs(d3.polygonArea(cell))

      if (area > 5000) {
        g.append('text')
          .attr('x', centroid[0])
          .attr('y', centroid[1] - 8)
          .attr('text-anchor', 'middle')
          .attr('font-size', '11px')
          .attr('font-weight', '600')
          .attr('fill', '#1e293b')
          .attr('pointer-events', 'none')
          .text(node.name.length > 15 ? node.name.slice(0, 12) + '...' : node.name)

        g.append('text')
          .attr('x', centroid[0])
          .attr('y', centroid[1] + 6)
          .attr('text-anchor', 'middle')
          .attr('font-size', '9px')
          .attr('fill', '#64748b')
          .attr('pointer-events', 'none')
          .text(formatBytes(node.size))
      }
    })

    // Draw files as small squares (not clickable)
    files.forEach((node) => {
      const radius = Math.max(4, Math.min(8, Math.log(node.size) / 2))

      g.append('rect')
        .attr('x', node.x! - radius)
        .attr('y', node.y! - radius)
        .attr('width', radius * 2)
        .attr('height', radius * 2)
        .attr('fill', '#64748b')
        .attr('fill-opacity', 0.6)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .style('cursor', 'default')
        .on('mouseover', function(event) {
          d3.select(this)
            .attr('fill-opacity', 0.9)
          showTooltip(event, node)
        })
        .on('mouseout', function() {
          d3.select(this)
            .attr('fill-opacity', 0.6)
          hideTooltip()
        })
    })

    const showTooltip = (event: any, node: Node) => {
      d3.selectAll('.voronoi-tooltip').remove()

      const tooltip = d3.select('body')
        .append('div')
        .attr('class', 'voronoi-tooltip')
        .style('position', 'absolute')
        .style('background', 'white')
        .style('border', '1px solid #e2e8f0')
        .style('border-radius', '8px')
        .style('padding', '12px')
        .style('color', '#1e293b')
        .style('font-size', '12px')
        .style('font-family', 'system-ui, sans-serif')
        .style('pointer-events', 'none')
        .style('z-index', '10000')
        .style('box-shadow', '0 4px 12px rgba(0, 0, 0, 0.1)')
        .style('max-width', '250px')

      tooltip.html(`
        <div style="font-weight: 600; margin-bottom: 6px;">
          ${node.isDirectory ? '📁' : '📄'} ${node.name}
        </div>
        <div style="color: #64748b; margin-bottom: 4px;">
          Size: <span style="font-weight: 600; color: #f59e0b;">${formatBytes(node.size)}</span>
        </div>
        ${node.isDirectory && node.file_count ? `
          <div style="color: #64748b;">
            Files: <span style="font-weight: 600; color: #3b82f6;">${node.file_count.toLocaleString()}</span>
          </div>
        ` : ''}
        <div style="color: #94a3af; margin-top: 8px; font-size: 10px; word-break: break-all; font-family: monospace;">
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
      d3.selectAll('.voronoi-tooltip')
        .transition()
        .duration(100)
        .style('opacity', 0)
        .remove()
    }

  }, [data, currentPath, setCurrentPath])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[700px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground text-sm">Loading diagram...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[700px]">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold text-destructive">Error loading data</p>
          <Button variant="outline" size="sm" onClick={() => setCurrentPath(path)}>
            Back to {path}
          </Button>
        </div>
      </div>
    )
  }

  // Check if we can navigate back
  const canGoBack = currentPath !== path

  return (
    <div className="space-y-3">
      {/* Breadcrumb navigation */}
      {canGoBack && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPath(path)}
            className="text-xs"
          >
            ← Back to root
          </Button>
          <div className="text-xs font-mono text-muted-foreground">
            Current: {currentPath}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Legend:</span>
          <span className="ml-3">■ Blue cells = Folders (clickable)</span>
          <span className="ml-3">■ Gray squares = Files (inside folders)</span>
        </div>
      </div>

      <div ref={containerRef} className="w-full rounded-xl overflow-hidden border border-border bg-white">
        <svg ref={svgRef} />
      </div>
    </div>
  )
}
