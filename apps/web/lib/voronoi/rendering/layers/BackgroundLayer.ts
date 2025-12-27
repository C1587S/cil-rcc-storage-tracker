import * as d3 from 'd3'
import { getSizeFillColor } from '@/lib/utils/icon-helpers'
import { getFileColor } from '@/lib/voronoi/utils/colors'
import { TERMINAL_COLORS } from '@/lib/voronoi/utils/constants'

export interface BackgroundLayerOptions {
  gBackgrounds: d3.Selection<SVGGElement, unknown, null, undefined>
  topLevelNodes: d3.HierarchyNode<any>[]
}

export class BackgroundLayer {
  private gBackgrounds: d3.Selection<SVGGElement, unknown, null, undefined>

  constructor(options: BackgroundLayerOptions) {
    this.gBackgrounds = options.gBackgrounds
  }

  render(topLevelNodes: d3.HierarchyNode<any>[]): void {
    topLevelNodes.forEach((d: any) => {
      const node = d.data
      const poly = d.polygon
      if (!poly) return

      const isSynthetic = node.isSynthetic
      let fillColor: string
      let fillOpacity: number
      let strokeColor: string
      let strokeWidth: number
      let strokeOpacity: number

      if (isSynthetic) {
        fillColor = TERMINAL_COLORS.filesContainer
        fillOpacity = 0.12
        strokeColor = TERMINAL_COLORS.filesContainer
        strokeWidth = 1.5
        strokeOpacity = 0.6
      } else if (node.isDirectory) {
        fillColor = getSizeFillColor(node.size)
        fillOpacity = 0.2
        strokeColor = fillColor
        strokeWidth = 2.5
        strokeOpacity = 0.7
      } else {
        fillColor = getFileColor(node.name)
        fillOpacity = 0.3
        strokeColor = fillColor
        strokeWidth = 1
        strokeOpacity = 0.6
      }

      this.gBackgrounds.append('path')
        .attr('class', 'voronoi-partition-bg')
        .attr('data-path', node.path)
        .attr('d', `M${poly.join('L')}Z`)
        .attr('fill', fillColor)
        .attr('fill-opacity', fillOpacity)
        .attr('stroke', strokeColor)
        .attr('stroke-width', strokeWidth)
        .attr('stroke-opacity', strokeOpacity)
        .attr('stroke-dasharray', isSynthetic ? '4,2' : 'none')
        .style('pointer-events', 'none')
        .datum({
          path: node.path,
          baseColor: fillColor,
          baseFillOpacity: fillOpacity,
          baseStrokeColor: strokeColor,
          baseStrokeWidth: strokeWidth,
          baseStrokeOpacity: strokeOpacity,
          isSynthetic
        })
    })
  }
}
