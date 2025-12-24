import * as d3 from 'd3'
import { type VoronoiNode } from '@/lib/voronoi-data-adapter'
import { formatBytes } from '@/lib/utils/formatters'
import { getFileColor } from '@/lib/voronoi/utils/colors'
import { HOVER_HIGHLIGHT_COLOR } from '@/lib/voronoi/utils/constants'
import { constrainToPolygon } from '@/lib/voronoi/utils/geometry'
import { packCirclesInPolygon } from '@/lib/voronoi/utils/circle-packing'

interface BubbleNode extends d3.SimulationNodeDatum {
  id: string
  r: number
  node: VoronoiNode
  polygon: any
}

export interface BubbleLayerOptions {
  gBubbles: d3.Selection<SVGGElement, unknown, null, undefined>
  topLevelNodes: d3.HierarchyNode<any>[]
  tooltipRef: React.RefObject<HTMLDivElement>
}

export class BubbleLayer {
  private gBubbles: d3.Selection<SVGGElement, unknown, null, undefined>
  private tooltipRef: React.RefObject<HTMLDivElement>
  private simulation: d3.Simulation<any, undefined> | null = null

  constructor(options: BubbleLayerOptions) {
    this.gBubbles = options.gBubbles
    this.tooltipRef = options.tooltipRef
  }

  render(topLevelNodes: d3.HierarchyNode<any>[]): d3.Simulation<any, undefined> | null {
    // Stop any existing simulation
    if (this.simulation) {
      this.simulation.stop()
      this.simulation = null
    }

    topLevelNodes.forEach((d: any) => {
      const node = d.data
      const poly = d.polygon
      if (!poly || !node.isSynthetic || !node.originalFiles) return

      const circles = packCirclesInPolygon(
        poly,
        node.originalFiles.map((f: any) => ({ node: f, value: f.size })),
        20
      )

      circles.forEach((c) => {
        const bubble = this.gBubbles.append('circle')
          .attr('class', 'file-bubble')
          .attr('data-path', c.node.path)
          .attr('cx', c.x)
          .attr('cy', c.y)
          .attr('r', c.r)
          .attr('fill', getFileColor(c.node.name))
          .attr('fill-opacity', 0.7)
          .attr('stroke', 'rgba(255,255,255,0.4)')
          .attr('stroke-width', 0.5)
          .attr('clip-path', `url(#clip-${node.uniqueId})`)
          .style('cursor', 'grab')
          .style('pointer-events', 'all')
          .datum({ ...c, polygon: poly, centroid: d3.polygonCentroid(poly) })

        this.attachBubbleEventHandlers(bubble)
      })

      // Setup physics simulation
      const bubbleNodes: BubbleNode[] = circles.map((c, i) => ({
        id: `b-${node.uniqueId}-${i}`,
        x: c.x,
        y: c.y,
        r: c.r,
        node: c.node,
        polygon: poly
      }))

      if (bubbleNodes.length > 0) {
        this.simulation = this.createSimulation(bubbleNodes, poly)
        this.attachDragBehavior(bubbleNodes)
      }
    })

    return this.simulation
  }

  private attachBubbleEventHandlers(
    bubble: d3.Selection<SVGCircleElement, any, SVGGElement, unknown>
  ): void {
    bubble
      .on('mouseenter', (event: MouseEvent, d: any) => {
        event.stopPropagation()
        const tooltip = this.tooltipRef.current
        if (tooltip) {
          tooltip.style.display = 'block'
          tooltip.style.left = event.pageX + 10 + 'px'
          tooltip.style.top = event.pageY + 10 + 'px'
          tooltip.innerHTML = `<div class="font-mono text-xs"><div class="font-bold text-cyan-400">${d.node.name}</div><div class="text-gray-400">${formatBytes(d.node.size)}</div></div>`
        }
        d3.select(event.currentTarget as SVGCircleElement)
          .attr('stroke', HOVER_HIGHLIGHT_COLOR)
          .attr('stroke-width', 2)
      })
      .on('mousemove', (event: MouseEvent) => {
        const tooltip = this.tooltipRef.current
        if (tooltip) {
          tooltip.style.left = event.pageX + 10 + 'px'
          tooltip.style.top = event.pageY + 10 + 'px'
        }
      })
      .on('mouseleave', (event: MouseEvent) => {
        const tooltip = this.tooltipRef.current
        if (tooltip) tooltip.style.display = 'none'
        const target = d3.select(event.currentTarget as SVGCircleElement)
        if (!target.classed('highlighted')) {
          target.attr('stroke', 'rgba(255,255,255,0.4)').attr('stroke-width', 0.5)
        }
      })
  }

  private createSimulation(
    bubbleNodes: BubbleNode[],
    poly: any
  ): d3.Simulation<any, undefined> {
    const simulation = d3.forceSimulation(bubbleNodes)
      .force('collision', d3.forceCollide<BubbleNode>().radius(d => d.r + 1).strength(0.8))
      .force('center', d3.forceCenter(
        d3.polygonCentroid(poly)[0],
        d3.polygonCentroid(poly)[1]
      ).strength(0.05))
      .force('charge', d3.forceManyBody<BubbleNode>().strength(-5))
      .alphaDecay(0.05)
      .on('tick', () => {
        bubbleNodes.forEach(b => {
          const c = constrainToPolygon(b.x!, b.y!, b.polygon, b.r)
          b.x = c[0]
          b.y = c[1]
        })
        this.gBubbles.selectAll<SVGCircleElement, any>('.file-bubble').each(function(datum: any) {
          const bn = bubbleNodes.find(b => b.node.path === datum.node.path)
          if (bn) {
            d3.select(this)
              .attr('cx', bn.x!)
              .attr('cy', bn.y!)
          }
        })
      })

    return simulation
  }

  private attachDragBehavior(bubbleNodes: BubbleNode[]): void {
    const simulation = this.simulation

    const drag = d3.drag<SVGCircleElement, any>()
      .on('start', function(this: SVGCircleElement, event: any) {
        event.sourceEvent.stopPropagation()
        if (!event.active && simulation) {
          simulation.alphaTarget(0.3).restart()
        }
        d3.select(this).style('cursor', 'grabbing')
        const datum = d3.select(this).datum() as any
        if (!datum) return
        const bn = bubbleNodes.find(b => b.node.path === datum.node.path)
        if (bn) {
          bn.fx = bn.x
          bn.fy = bn.y
        }
      })
      .on('drag', function(this: SVGCircleElement, event: any) {
        const datum = d3.select(this).datum() as any
        if (!datum) return
        const bn = bubbleNodes.find(b => b.node.path === datum.node.path)
        if (bn) {
          const c = constrainToPolygon(event.x, event.y, datum.polygon, bn.r)
          bn.fx = c[0]
          bn.fy = c[1]
        }
      })
      .on('end', function(this: SVGCircleElement, event: any) {
        if (!event.active && simulation) {
          simulation.alphaTarget(0)
        }
        d3.select(this).style('cursor', 'grab')
        const datum = d3.select(this).datum() as any
        if (!datum) return
        const bn = bubbleNodes.find(b => b.node.path === datum.node.path)
        if (bn) {
          bn.fx = null
          bn.fy = null
        }
      })

    this.gBubbles.selectAll('.file-bubble').call(drag as any)
  }

  stop(): void {
    if (this.simulation) {
      this.simulation.stop()
      this.simulation = null
    }
  }
}
