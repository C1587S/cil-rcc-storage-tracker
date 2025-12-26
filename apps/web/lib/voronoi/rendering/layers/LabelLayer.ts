import * as d3 from 'd3'
import { TERMINAL_COLORS } from '@/lib/voronoi/utils/constants'
import { getPolygonBounds } from '@/lib/voronoi/utils/geometry'

export interface LabelLayerOptions {
  gLabels: d3.Selection<SVGGElement, unknown, null, undefined>
  topLevelNodes: d3.HierarchyNode<any>[]
  viewportWidth: number
}

export class LabelLayer {
  private gLabels: d3.Selection<SVGGElement, unknown, null, undefined>
  private viewportWidth: number

  constructor(options: LabelLayerOptions) {
    this.gLabels = options.gLabels
    this.viewportWidth = options.viewportWidth
  }

  render(topLevelNodes: d3.HierarchyNode<any>[]): void {
    // Scale font size based on viewport width
    // Base width (1278px) uses max font size of 13px
    // Larger widths scale up proportionally
    const baseWidth = 1278
    const baseFontSizeMax = 13
    const fontSizeScale = Math.max(1, this.viewportWidth / baseWidth)
    const maxFontSize = baseFontSizeMax * fontSizeScale

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
          .text(displayName)
      }
    })
  }
}
