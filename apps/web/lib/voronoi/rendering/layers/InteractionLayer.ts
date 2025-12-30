import * as d3 from 'd3'
import { type PartitionInfo } from '@/lib/voronoi/utils/types'

export interface InteractionLayerOptions {
  gInteraction: d3.Selection<SVGGElement, unknown, null, undefined>
  gBackgrounds: d3.Selection<SVGGElement, unknown, null, undefined>
  topLevelNodes: d3.HierarchyNode<any>[]
  highlightColor: string
  getPartitionQuotaPercent: (size: number) => number
  getFileQuotaPercent: (fileCount: number) => number
  getParentQuotaPercent: (size: number) => number
  parentSize: number
  selectedPartition: PartitionInfo | null
  setHoveredPartition: (info: PartitionInfo | null) => void
  handleInspect: (info: PartitionInfo) => void
  performDrillDown: (path: string) => void
}

export class InteractionLayer {
  private gInteraction: d3.Selection<SVGGElement, unknown, null, undefined>
  private gBackgrounds: d3.Selection<SVGGElement, unknown, null, undefined>
  private highlightColor: string
  private options: Omit<InteractionLayerOptions, 'gInteraction' | 'gBackgrounds' | 'topLevelNodes' | 'highlightColor'>

  constructor(options: InteractionLayerOptions) {
    this.gInteraction = options.gInteraction
    this.gBackgrounds = options.gBackgrounds
    this.highlightColor = options.highlightColor
    this.options = {
      getPartitionQuotaPercent: options.getPartitionQuotaPercent,
      getFileQuotaPercent: options.getFileQuotaPercent,
      getParentQuotaPercent: options.getParentQuotaPercent,
      parentSize: options.parentSize,
      selectedPartition: options.selectedPartition,
      setHoveredPartition: options.setHoveredPartition,
      handleInspect: options.handleInspect,
      performDrillDown: options.performDrillDown
    }
  }

  render(topLevelNodes: d3.HierarchyNode<any>[]): void {
    // Render regular interaction overlays
    topLevelNodes.forEach((d: any) => {
      const node = d.data
      const poly = d.polygon
      if (!poly) return

      if (!node.isSynthetic) {
        this.renderRegularOverlay(node, poly)
      } else {
        this.renderSyntheticHoverZone(node, poly)
      }
    })
  }

  private createPartitionInfo(node: any): PartitionInfo {
    // DEBUG: Log file count information
    console.log('[InteractionLayer] Creating PartitionInfo:', {
      path: node.path,
      name: node.name,
      file_count: node.file_count,
      size: node.size,
      isDirectory: node.isDirectory,
      isSynthetic: node.isSynthetic,
      nodeKeys: Object.keys(node)
    })

    return {
      name: node.isSynthetic ? `Files (${node.file_count})` : node.name,
      path: node.path,
      size: node.size,
      file_count: node.file_count || 0,
      isDirectory: node.isDirectory,
      isSynthetic: node.isSynthetic,
      quotaPercent: this.options.getPartitionQuotaPercent(node.size),
      fileQuotaPercent: this.options.getFileQuotaPercent(node.file_count || 0),
      parentSize: this.options.parentSize,
      parentQuotaPercent: this.options.getParentQuotaPercent(node.size),
      depth: 1,
      originalFiles: node.originalFiles
    }
  }

  private renderRegularOverlay(node: any, poly: any): void {
    const partitionInfo = this.createPartitionInfo(node)

    const overlay = this.gInteraction.append('path')
      .attr('class', 'voronoi-interaction-overlay')
      .attr('data-path', node.path)
      .attr('data-is-directory', node.isDirectory ? 'true' : 'false')
      .attr('data-is-synthetic', node.isSynthetic ? 'true' : 'false')
      .attr('d', `M${poly.join('L')}Z`)
      .attr('fill', 'transparent')
      .attr('stroke', 'none')
      .style('cursor', (!node.isSynthetic && node.isDirectory) ? 'pointer' : 'default')
      .style('pointer-events', node.isSynthetic ? 'none' : 'all')
      .datum(partitionInfo)

    // Mouse enter
    overlay.on('mouseenter', (event: MouseEvent) => {
      if ((event.relatedTarget as Element)?.classList?.contains('file-bubble')) return
      const pathAttr = d3.select(event.currentTarget as SVGPathElement).attr('data-path')
      this.highlightPartition(pathAttr)
      this.options.setHoveredPartition(d3.select(event.currentTarget as SVGPathElement).datum() as PartitionInfo)
    })

    // Mouse leave
    overlay.on('mouseleave', (event: MouseEvent) => {
      if ((event.relatedTarget as Element)?.classList?.contains('file-bubble')) return
      const pathAttr = d3.select(event.currentTarget as SVGPathElement).attr('data-path')
      const data = d3.select(event.currentTarget as SVGPathElement).datum() as PartitionInfo
      if (this.options.selectedPartition?.path !== data.path) {
        this.resetPartitionStyle(pathAttr)
      }
      this.options.setHoveredPartition(null)
    })

    // Context menu
    overlay.on('contextmenu', (e: MouseEvent) => {
      e.preventDefault()
      const pathAttr = d3.select(e.currentTarget as SVGPathElement).attr('data-path')
      this.gBackgrounds.selectAll('.voronoi-partition-bg').style('filter', 'none')
      this.gBackgrounds.selectAll('.voronoi-partition-bg')
        .filter(function() { return d3.select(this).attr('data-path') === pathAttr })
        .style('filter', `drop-shadow(0 0 12px ${this.highlightColor})`)
      this.options.handleInspect(d3.select(e.currentTarget as SVGPathElement).datum() as PartitionInfo)
    })

    // Click to drill down
    if (node.isDirectory) {
      overlay.on('click', (e: MouseEvent) => {
        e.stopPropagation()
        const clickedPath = d3.select(e.currentTarget as SVGPathElement).attr('data-path')
        const isDir = d3.select(e.currentTarget as SVGPathElement).attr('data-is-directory') === 'true'
        const isSyn = d3.select(e.currentTarget as SVGPathElement).attr('data-is-synthetic') === 'true'
        if (clickedPath && isDir && !isSyn) {
          this.options.performDrillDown(clickedPath)
        }
      })
    }
  }

  private renderSyntheticHoverZone(node: any, poly: any): void {
    const partitionInfo = this.createPartitionInfo(node)

    this.gBackgrounds.append('path')
      .attr('class', 'voronoi-synthetic-hover-zone')
      .attr('data-path', node.path)
      .attr('d', `M${poly.join('L')}Z`)
      .attr('fill', 'transparent')
      .attr('stroke', 'none')
      .style('pointer-events', 'all')
      .lower()
      .datum(partitionInfo)
      .on('mouseenter', (event: MouseEvent) => {
        const pathAttr = d3.select(event.currentTarget as SVGPathElement).attr('data-path')
        this.gBackgrounds.selectAll('.voronoi-partition-bg')
          .filter(function() { return d3.select(this).attr('data-path') === pathAttr })
          .attr('fill', this.highlightColor)
          .attr('fill-opacity', 0.2)
          .attr('stroke', this.highlightColor)
          .attr('stroke-width', 2)
          .attr('stroke-opacity', 0.8)
          .style('filter', `drop-shadow(0 0 6px ${this.highlightColor})`)
        this.options.setHoveredPartition(d3.select(event.currentTarget as SVGPathElement).datum() as PartitionInfo)
      })
      .on('mouseleave', (event: MouseEvent) => {
        const pathAttr = d3.select(event.currentTarget as SVGPathElement).attr('data-path')
        const data = d3.select(event.currentTarget as SVGPathElement).datum() as PartitionInfo
        if (this.options.selectedPartition?.path !== data.path) {
          this.resetPartitionStyle(pathAttr)
        }
        this.options.setHoveredPartition(null)
      })
      .on('contextmenu', (e: MouseEvent) => {
        e.preventDefault()
        this.options.handleInspect(d3.select(e.currentTarget as SVGPathElement).datum() as PartitionInfo)
      })
  }

  private highlightPartition(pathAttr: string): void {
    this.gBackgrounds.selectAll('.voronoi-partition-bg')
      .filter(function() { return d3.select(this).attr('data-path') === pathAttr })
      .attr('fill', this.highlightColor)
      .attr('fill-opacity', 0.35)
      .attr('stroke', this.highlightColor)
      .attr('stroke-width', 3.5)
      .attr('stroke-opacity', 1)
      .style('filter', `drop-shadow(0 0 8px ${this.highlightColor})`)
  }

  private resetPartitionStyle(pathAttr: string): void {
    this.gBackgrounds.selectAll('.voronoi-partition-bg')
      .filter(function() { return d3.select(this).attr('data-path') === pathAttr })
      .each(function() {
        const bg = d3.select(this).datum() as any
        d3.select(this)
          .attr('fill', bg.baseColor)
          .attr('fill-opacity', bg.baseFillOpacity)
          .attr('stroke', bg.baseStrokeColor)
          .attr('stroke-width', bg.baseStrokeWidth)
          .attr('stroke-opacity', bg.baseStrokeOpacity)
          .style('filter', 'none')
      })
  }
}
