import * as d3 from 'd3'
import { TERMINAL_COLORS } from '@/lib/voronoi/utils/constants'
import { getPolygonBounds } from '@/lib/voronoi/utils/geometry'

export interface LabelLayerOptions {
  gLabels: d3.Selection<SVGGElement, unknown, null, undefined>
  topLevelNodes: d3.HierarchyNode<any>[]
  viewportWidth: number
  isFullscreen: boolean
}

export class LabelLayer {
  private gLabels: d3.Selection<SVGGElement, unknown, null, undefined>
  private viewportWidth: number
  private isFullscreen: boolean

  constructor(options: LabelLayerOptions) {
    this.gLabels = options.gLabels
    this.viewportWidth = options.viewportWidth
    this.isFullscreen = options.isFullscreen
  }

  render(topLevelNodes: d3.HierarchyNode<any>[]): void {
    // Scale font size based on viewport width
    // Base width (1278px) uses max font size of 13px
    // In fullscreen mode, reduce font size by 20% for better visual fit
    const baseWidth = 1278
    const baseFontSizeMax = 13
    const fullscreenReduction = this.isFullscreen ? 0.8 : 1.0
    const fontSizeScale = Math.max(1, this.viewportWidth / baseWidth)
    const maxFontSize = baseFontSizeMax * fontSizeScale * fullscreenReduction

    topLevelNodes.forEach((d: any) => {
      const node = d.data
      const poly = d.polygon
      if (!poly) return

      const bounds = getPolygonBounds(poly)
      if (bounds.width > 30 && bounds.height > 20) {
        const centroid = d3.polygonCentroid(poly)
        const displayName = node.isSynthetic
          ? `${node.file_count} files`
          : (node.name.length > 20 ? node.name.slice(0, 17) + '...' : node.name)
        const fontSize = Math.min(maxFontSize, Math.max(7, bounds.width / displayName.length * 1.2 * fontSizeScale))

        // Calculate text bounding box for background
        const textWidth = displayName.length * fontSize * 0.6
        const textHeight = fontSize * 1.4
        const padding = 4

        // Add subtle background rectangle
        this.gLabels.append('rect')
          .attr('x', centroid[0] - textWidth / 2 - padding)
          .attr('y', centroid[1] - textHeight / 2 - padding)
          .attr('width', textWidth + padding * 2)
          .attr('height', textHeight + padding * 2)
          .attr('rx', 3)
          .attr('ry', 3)
          .attr('fill', 'rgba(0, 0, 0, 0.3)')
          .style('pointer-events', 'none')

        // Add subtle shadow for improved visibility
        this.gLabels.append('text')
          .attr('x', centroid[0])
          .attr('y', centroid[1] + 0.5)  // Slight offset for shadow
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('fill', 'rgba(0, 0, 0, 0.4)')  // Semi-transparent black shadow
          .attr('font-size', fontSize)
          .attr('font-weight', '600')
          .attr('font-family', 'monospace')
          .style('pointer-events', 'none')
          .text(displayName)

        // Main text with stroke outline
        this.gLabels.append('text')
          .attr('x', centroid[0])
          .attr('y', centroid[1])
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('fill', node.isSynthetic ? TERMINAL_COLORS.filesContainer : '#b0b0b0')
          .attr('stroke', 'white')
          .attr('stroke-width', 0.5)
          .attr('font-size', fontSize)
          .attr('font-weight', '600')
          .attr('font-family', 'monospace')
          .style('pointer-events', 'none')
          .style('paint-order', 'stroke fill')
          .style('filter', 'drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.3))')  // Additional drop shadow
          .text(displayName)
      }
    })
  }
}
