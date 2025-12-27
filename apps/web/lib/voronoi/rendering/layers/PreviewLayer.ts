import * as d3 from 'd3'
import { getSizeFillColor } from '@/lib/utils/icon-helpers'
import { getFileColor } from '@/lib/voronoi/utils/colors'
import { TERMINAL_COLORS } from '@/lib/voronoi/utils/constants'

export interface PreviewLayerOptions {
  gPreview: d3.Selection<SVGGElement, unknown, null, undefined>
  previewNodes: d3.HierarchyNode<any>[]
}

export class PreviewLayer {
  private gPreview: d3.Selection<SVGGElement, unknown, null, undefined>

  constructor(options: PreviewLayerOptions) {
    this.gPreview = options.gPreview
  }

  render(previewNodes: d3.HierarchyNode<any>[]): void {
    previewNodes.forEach((d: any) => {
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
        fillOpacity = 0.03
        strokeColor = TERMINAL_COLORS.filesContainer
        strokeWidth = 0.5
        strokeOpacity = 0.25
      } else if (node.isDirectory) {
        fillColor = getSizeFillColor(node.size)
        fillOpacity = 0.03
        strokeColor = '#ffffff'
        strokeWidth = 1.2
        strokeOpacity = 0.5
      } else {
        fillColor = getFileColor(node.name)
        fillOpacity = 0.08
        strokeColor = fillColor
        strokeWidth = 0.5
        strokeOpacity = 0.25
      }

      this.gPreview.append('path')
        .attr('class', 'voronoi-partition-preview')
        .attr('data-path', node.path)
        .attr('d', `M${poly.join('L')}Z`)
        .attr('fill', fillColor)
        .attr('fill-opacity', fillOpacity)
        .attr('stroke', strokeColor)
        .attr('stroke-width', strokeWidth)
        .attr('stroke-opacity', strokeOpacity)
        .attr('stroke-dasharray', isSynthetic ? '3,1' : 'none')
        .style('pointer-events', 'none')
    })
  }
}
