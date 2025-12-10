'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { vizApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { useNavigationStore } from '@/lib/stores/navigationStore'
import { getFileExtension } from '@/lib/utils/formatters'

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

const CATEGORY_COLORS: Record<string, string> = {
  'Code': '#3b82f6',
  'Data': '#10b981',
  'Document': '#f59e0b',
  'System': '#6b7280',
  'Archive': '#8b5cf6',
  'Image': '#14b8a6',
  'Video': '#ec4899',
  'Directory': '#3b82f6',
  'Other': '#94a3b8',
}

const FILE_TYPE_CATEGORIES: Record<string, string> = {
  'py': 'Code',
  'js': 'Code',
  'ts': 'Code',
  'java': 'Code',
  'cpp': 'Code',
  'c': 'Code',
  'rs': 'Code',
  'go': 'Code',
  'json': 'Data',
  'csv': 'Data',
  'xml': 'Data',
  'parquet': 'Data',
  'txt': 'Document',
  'md': 'Document',
  'pdf': 'Document',
  'log': 'System',
  'zip': 'Archive',
  'tar': 'Archive',
  'gz': 'Archive',
  'png': 'Image',
  'jpg': 'Image',
  'jpeg': 'Image',
  'mp4': 'Video',
}

const getNodeCategory = (name: string, hasChildren: boolean): string => {
  if (hasChildren) return 'Directory'
  const ext = getFileExtension(name).toLowerCase()
  return FILE_TYPE_CATEGORIES[ext] || 'Other'
}

const getColorForNode = (name: string, hasChildren: boolean): string => {
  const category = getNodeCategory(name, hasChildren)
  return CATEGORY_COLORS[category]
}

interface CirclePackViewProps {
  path: string
  snapshot: string
}

export function CirclePackView({ path, snapshot }: CirclePackViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const { setCurrentPath } = useNavigationStore()
  const [currentFocus, setCurrentFocus] = useState<any>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['treemap', path, snapshot],
    queryFn: () => vizApi.treemap(path, snapshot, 3),
    enabled: !!snapshot,
  })

  useEffect(() => {
    if (!data || !svgRef.current) return

    const width = svgRef.current.clientWidth
    const height = svgRef.current.clientHeight

    // Clear previous visualization
    d3.select(svgRef.current).selectAll('*').remove()

    // Create SVG container
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])
      .style('cursor', 'pointer')

    // Create pack layout
    const pack = d3.pack()
      .size([width, height])
      .padding(3)

    // Create hierarchy
    const root = d3.hierarchy(data)
      .sum((d: any) => d.size || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const nodes = pack(root).descendants()

    // Color scale
    const color = (d: any) => {
      if (!d.data) return CATEGORY_COLORS['Other']
      return getColorForNode(
        d.data.name,
        d.children && d.children.length > 0
      )
    }

    // Create tooltip
    const tooltip = d3.select(tooltipRef.current)

    // Initial focus
    let focus = root
    setCurrentFocus(focus)

    // Create circles
    const circle = svg.append('g')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('class', (d: any) => d.children ? 'node-parent' : 'node-leaf')
      .attr('fill', (d: any) => color(d))
      .attr('stroke', (d: any) => d === focus ? '#fff' : 'none')
      .attr('stroke-width', 2)
      .style('opacity', 0.9)
      .on('mouseover', function(event, d: any) {
        d3.select(this)
          .style('opacity', 1)
          .attr('stroke', '#fff')
          .attr('stroke-width', 2)

        const displayName = d.data?.name?.split('/').pop() || d.data?.name || ''
        const category = getNodeCategory(
          d.data?.name || '',
          d.children && d.children.length > 0
        )

        tooltip
          .style('opacity', 1)
          .style('left', `${event.pageX + 10}px`)
          .style('top', `${event.pageY - 10}px`)
          .html(`
            <div class="font-semibold text-sm mb-1">${displayName}</div>
            <div class="text-xs space-y-0.5">
              <div>Size: ${formatBytes(d.value || 0)}</div>
              <div>Category: <span class="inline-flex items-center gap-1">
                <span class="inline-block w-2 h-2 rounded-sm" style="background-color: ${CATEGORY_COLORS[category]}"></span>
                ${category}
              </span></div>
              ${d.data?.file_count > 1 ? `<div>Items: ${(d.data.file_count || 0).toLocaleString()}</div>` : ''}
              ${d.children ? '<div class="text-primary italic mt-1">Click to zoom in</div>' : ''}
            </div>
          `)
      })
      .on('mouseout', function() {
        d3.select(this)
          .style('opacity', 0.9)
          .attr('stroke', 'none')

        tooltip.style('opacity', 0)
      })
      .on('click', function(event, d: any) {
        event.stopPropagation()
        if (focus !== d && d.children) {
          zoom(d)
          if (d.data?.path) {
            setCurrentPath(d.data.path)
          }
        }
      })

    // Create labels
    const label = svg.append('g')
      .style('font', '10px sans-serif')
      .attr('pointer-events', 'none')
      .attr('text-anchor', 'middle')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .style('fill-opacity', (d: any) => d.parent === focus ? 1 : 0)
      .style('display', (d: any) => d.parent === focus ? 'inline' : 'none')
      .style('fill', '#fff')
      .style('font-weight', 'bold')
      .style('text-shadow', '0 1px 2px rgba(0,0,0,0.6)')
      .text((d: any) => {
        const name = d.data?.name?.split('/').pop() || d.data?.name || ''
        return name.length > 15 ? name.substring(0, 12) + '...' : name
      })

    // Position elements initially
    zoomTo([root.x, root.y, root.r * 2])

    function zoomTo(v: number[]) {
      const k = width / v[2]

      circle
        .attr('cx', (d: any) => (d.x - v[0]) * k + width / 2)
        .attr('cy', (d: any) => (d.y - v[1]) * k + height / 2)
        .attr('r', (d: any) => d.r * k)

      label
        .attr('x', (d: any) => (d.x - v[0]) * k + width / 2)
        .attr('y', (d: any) => (d.y - v[1]) * k + height / 2)
        .style('font-size', (d: any) => `${Math.max(10, d.r * k / 5)}px`)
    }

    function zoom(d: any) {
      focus = d
      setCurrentFocus(d)

      const transition = svg.transition()
        .duration(750)
        .tween('zoom', () => {
          const i = d3.interpolateZoom(
            [focus.x, focus.y, focus.r * 2],
            [d.x, d.y, d.r * 2]
          )
          return (t: number) => zoomTo(i(t))
        })

      label
        .filter(function(this: any, d: any) { return d.parent === focus || this.style.display === 'inline' })
        .transition(transition as any)
        .style('fill-opacity', (d: any) => d.parent === focus ? 1 : 0)
        .on('start', function(this: any, d: any) { if (d.parent === focus) this.style.display = 'inline' })
        .on('end', function(this: any, d: any) { if (d.parent !== focus) this.style.display = 'none' })
    }

    // Click on SVG to zoom out
    svg.on('click', () => {
      if (focus !== root) {
        zoom(root)
        setCurrentPath(path)
      }
    })

  }, [data, path, setCurrentPath])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading circle pack visualization...
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No data available
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      {currentFocus && currentFocus !== data && (
        <div className="absolute top-2 left-2 z-10 bg-background/90 border border-border rounded px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">Viewing: </span>
          <span className="font-medium">{currentFocus.data?.name || 'Root'}</span>
          <span className="text-muted-foreground ml-2">(Click background to zoom out)</span>
        </div>
      )}
      <svg ref={svgRef} className="w-full h-full" />
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none bg-background border border-border rounded-lg shadow-lg p-3 opacity-0 transition-opacity z-20"
        style={{ maxWidth: '300px' }}
      />
    </div>
  )
}
