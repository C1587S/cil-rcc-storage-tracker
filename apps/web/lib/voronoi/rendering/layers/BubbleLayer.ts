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

    console.log('[BubbleLayer] render() called:', {
      topLevelNodesCount: topLevelNodes.length,
      nodesWithOriginalFiles: topLevelNodes.filter(d => d.data.originalFiles?.length > 0).length
    })

    // Collect all bubble nodes across all partitions for a unified simulation
    const allBubbleNodes: BubbleNode[] = []

    // Render bubbles for top-level nodes (depth=1)
    // These are the main partitions visible on screen
    topLevelNodes.forEach((d: any, idx: number) => {
      const node = d.data
      const poly = d.polygon

      console.log(`[BubbleLayer] Processing node ${idx}:`, {
        path: node.path,
        name: node.name,
        hasPoly: !!poly,
        hasOriginalFiles: !!node.originalFiles,
        originalFilesCount: node.originalFiles?.length || 0,
        isSynthetic: node.isSynthetic
      })

      // Render bubbles for ANY node with originalFiles (not just synthetic nodes)
      // This handles both on-the-fly mode (__files__ synthetic nodes) and precomputed mode (regular directories with files)
      if (!poly || !node.originalFiles || node.originalFiles.length === 0) return

      const circles = packCirclesInPolygon(
        poly,
        node.originalFiles.map((f: any) => ({ node: f, value: f.size })),
        20
      )

      circles.forEach((c) => {
        // Validate circle coordinates before creating SVG element
        if (!isFinite(c.x) || !isFinite(c.y) || !isFinite(c.r)) {
          console.warn('[BubbleLayer] Invalid circle data:', c)
          return
        }

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

        this.attachBubbleEventHandlers(bubble as any)
      })

      // Add bubbles from this partition to the global collection
      const bubbleNodes: BubbleNode[] = circles.map((c, i) => ({
        id: `b-${node.uniqueId}-${i}`,
        x: c.x,
        y: c.y,
        r: c.r,
        node: c.node,
        polygon: poly
      }))

      allBubbleNodes.push(...bubbleNodes)
    })

    // Create ONE simulation for ALL bubbles across all partitions
    if (allBubbleNodes.length > 0) {
      console.log('[BubbleLayer] Creating unified simulation with', allBubbleNodes.length, 'bubbles')
      this.simulation = this.createMultiPartitionSimulation(allBubbleNodes)
      this.attachDragBehavior(allBubbleNodes)
    }

    return this.simulation
  }

  private attachBubbleEventHandlers(
    bubble: d3.Selection<SVGCircleElement, any, SVGGElement, unknown>
  ): void {
    bubble
      .on('mouseenter', (event: MouseEvent, d: any) => {
        // Don't stop propagation - let drag events pass through
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

  /**
   * Create a unified physics simulation for bubbles across multiple partitions.
   * Each bubble is constrained to its own partition polygon.
   */
  private createMultiPartitionSimulation(
    bubbleNodes: BubbleNode[]
  ): d3.Simulation<any, undefined> {
    const simulation = d3.forceSimulation(bubbleNodes)
      // Collision force: Prevent bubbles from overlapping
      .force('collision', d3.forceCollide<BubbleNode>().radius(d => d.r + 1).strength(0.8))
      // Charge force: Create repulsion between bubbles (negative = repel)
      .force('charge', d3.forceManyBody<BubbleNode>().strength(-5))
      // Custom positioning force: Each bubble gravitates toward its partition centroid
      .force('position', d3.forceX<BubbleNode>().x(d => d3.polygonCentroid(d.polygon)[0]).strength(0.05))
      .force('positionY', d3.forceY<BubbleNode>().y(d => d3.polygonCentroid(d.polygon)[1]).strength(0.05))
      .alphaDecay(0.05)
      .on('tick', () => {
        // Constrain each bubble to its partition polygon
        bubbleNodes.forEach(b => {
          const c = constrainToPolygon(b.x!, b.y!, b.polygon, b.r)
          b.x = c[0]
          b.y = c[1]
        })
        // Update SVG circle positions
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
