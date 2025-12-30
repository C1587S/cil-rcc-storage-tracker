import * as d3 from 'd3'
import { type VoronoiNode } from '@/lib/voronoi-data-adapter'
import { formatBytes } from '@/lib/utils/formatters'
import { getFileColor } from '@/lib/voronoi/utils/colors'
import { getFileCategory } from '@/lib/voronoi/utils/file-categories'
import { constrainToPolygon } from '@/lib/voronoi/utils/geometry'
import { packCirclesInPolygon } from '@/lib/voronoi/utils/circle-packing'

interface BubbleNode extends d3.SimulationNodeDatum {
  id: string
  r: number
  node: VoronoiNode
  polygon: any
  category: string  // File category for clustering
}

export interface BubbleLayerOptions {
  gBubbles: d3.Selection<SVGGElement, unknown, null, undefined>
  topLevelNodes: d3.HierarchyNode<any>[]
  tooltipRef: React.RefObject<HTMLDivElement>
  highlightColor: string
  theme: 'dark' | 'light'
}

export class BubbleLayer {
  private gBubbles: d3.Selection<SVGGElement, unknown, null, undefined>
  private tooltipRef: React.RefObject<HTMLDivElement>
  private highlightColor: string
  private theme: 'dark' | 'light'
  private simulation: d3.Simulation<any, undefined> | null = null

  constructor(options: BubbleLayerOptions) {
    this.gBubbles = options.gBubbles
    this.tooltipRef = options.tooltipRef
    this.highlightColor = options.highlightColor
    this.theme = options.theme
  }

  render(topLevelNodes: d3.HierarchyNode<any>[]): d3.Simulation<any, undefined> | null {
    // Stop any existing simulation
    if (this.simulation) {
      this.simulation.stop()
      this.simulation = null
    }

    // Collect all bubble nodes across all partitions for a unified simulation
    const allBubbleNodes: BubbleNode[] = []

    // Render bubbles for top-level nodes (depth=1)
    // These are the main partitions visible on screen
    topLevelNodes.forEach((d: any) => {
      const node = d.data
      const poly = d.polygon

      // Render bubbles for ANY node with originalFiles (not just synthetic nodes)
      // This handles both on-the-fly mode (__files__ synthetic nodes) and precomputed mode (regular directories with files)
      if (!poly || !node.originalFiles || node.originalFiles.length === 0) return

      const circles = packCirclesInPolygon(
        poly,
        node.originalFiles.map((f: any) => ({ node: f, value: f.size })),
        1500  // Increased from 100 to ensure all files are rendered (up to 1500)
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
          .attr('fill', getFileColor(c.node.name, this.theme))
          .attr('fill-opacity', this.theme === 'dark' ? 1.0 : 0.85)
          .attr('stroke', this.theme === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.15)')
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
        polygon: poly,
        category: getFileCategory(c.node.name)  // Add category for clustering
      }))

      allBubbleNodes.push(...bubbleNodes)
    })

    // Create ONE simulation for ALL bubbles across all partitions
    if (allBubbleNodes.length > 0) {
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
          .attr('stroke', this.highlightColor)
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
          const defaultStroke = this.theme === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.15)'
          target.attr('stroke', defaultStroke).attr('stroke-width', 0.5)
        }
      })
  }

  /**
   * Create a unified physics simulation for bubbles across multiple partitions.
   * Each bubble is constrained to its own partition polygon.
   *
   * NEW FEATURES:
   * - Category-based clustering: Bubbles of same category attract each other
   * - Enhanced border repulsion: Bubbles "fear" partition edges
   */
  private createMultiPartitionSimulation(
    bubbleNodes: BubbleNode[]
  ): d3.Simulation<any, undefined> {
    const simulation = d3.forceSimulation(bubbleNodes)
      // Collision force: STRONG prevention of overlap (optimized for performance)
      .force('collision', d3.forceCollide<BubbleNode>()
        .radius(d => d.r + 2)  // Increased padding from 1.5 to 2
        .strength(1.0)  // Maximum strength for no overlap
        .iterations(1))  // OPTIMIZED: Reduced from 3 to 1 for faster performance
      // Charge force: Create repulsion between bubbles (negative = repel)
      .force('charge', d3.forceManyBody<BubbleNode>().strength(-10))  // Increased from -8
      // Category clustering: Bubbles of same category attract each other (ENHANCED)
      .force('category-cluster', this.createCategoryClusteringForce(bubbleNodes))
      // Size-based gravity: Large bubbles attract smaller ones
      .force('size-gravity', this.createSizeBasedGravityForce(bubbleNodes))
      // Custom positioning force: Each bubble gravitates toward its partition centroid
      .force('position', d3.forceX<BubbleNode>().x(d => d3.polygonCentroid(d.polygon)[0]).strength(0.02))  // Reduced from 0.03
      .force('positionY', d3.forceY<BubbleNode>().y(d => d3.polygonCentroid(d.polygon)[1]).strength(0.02))  // Reduced from 0.03
      .alphaDecay(0.05)  // OPTIMIZED: Increased from 0.03 for faster convergence
      .on('tick', () => {
        // Constrain each bubble to its partition polygon with ENHANCED border repulsion
        bubbleNodes.forEach(b => {
          const c = constrainToPolygon(b.x!, b.y!, b.polygon, b.r)

          // Apply border repulsion: Push bubbles away from edges
          const pushStrength = this.calculateBorderRepulsion(b.x!, b.y!, b.polygon, b.r)
          if (pushStrength.fx !== 0 || pushStrength.fy !== 0) {
            b.vx = (b.vx || 0) + pushStrength.fx
            b.vy = (b.vy || 0) + pushStrength.fy
          }

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

  /**
   * Create a force that attracts bubbles of the same category together (ENHANCED)
   */
  private createCategoryClusteringForce(bubbleNodes: BubbleNode[]): (alpha: number) => void {
    return (alpha: number) => {
      const strength = 0.25 * alpha  // INCREASED from 0.15 - stronger clustering

      for (let i = 0; i < bubbleNodes.length; i++) {
        for (let j = i + 1; j < bubbleNodes.length; j++) {
          const a = bubbleNodes[i]
          const b = bubbleNodes[j]

          // Only cluster if same category AND same partition
          if (a.category === b.category && a.polygon === b.polygon) {
            const dx = (b.x || 0) - (a.x || 0)
            const dy = (b.y || 0) - (a.y || 0)
            const distance = Math.sqrt(dx * dx + dy * dy)

            if (distance > 0) {
              // Attract towards each other (positive force)
              // Stronger attraction for closer bubbles
              const force = (strength * 2) / distance
              const fx = dx * force
              const fy = dy * force

              a.vx = (a.vx || 0) + fx
              a.vy = (a.vy || 0) + fy
              b.vx = (b.vx || 0) - fx
              b.vy = (b.vy || 0) - fy
            }
          }
        }
      }
    }
  }

  /**
   * Create size-based gravity force
   * Large bubbles attract smaller ones - larger bubbles stay central with smaller surrounding
   */
  private createSizeBasedGravityForce(bubbleNodes: BubbleNode[]): (alpha: number) => void {
    return (alpha: number) => {
      const strength = 0.08 * alpha  // Moderate strength to not override other forces

      for (let i = 0; i < bubbleNodes.length; i++) {
        for (let j = i + 1; j < bubbleNodes.length; j++) {
          const a = bubbleNodes[i]
          const b = bubbleNodes[j]

          // Only apply within same partition
          if (a.polygon !== b.polygon) continue

          const dx = (b.x || 0) - (a.x || 0)
          const dy = (b.y || 0) - (a.y || 0)
          const distance = Math.sqrt(dx * dx + dy * dy)

          if (distance > 0) {
            // Larger bubble has stronger gravity
            // The mass difference determines the strength of attraction
            const massA = a.r * a.r  // Approximate mass (area)
            const massB = b.r * b.r

            // Smaller bubble is attracted to larger bubble
            if (massA > massB) {
              // B is attracted to A
              const force = (strength * (massA - massB)) / (distance * distance)
              const fx = -dx * force  // Negative because we want B to move toward A
              const fy = -dy * force

              b.vx = (b.vx || 0) + fx
              b.vy = (b.vy || 0) + fy
            } else if (massB > massA) {
              // A is attracted to B
              const force = (strength * (massB - massA)) / (distance * distance)
              const fx = dx * force
              const fy = dy * force

              a.vx = (a.vx || 0) + fx
              a.vy = (a.vy || 0) + fy
            }
          }
        }
      }
    }
  }

  /**
   * Calculate repulsive force from partition borders
   * Bubbles "fear" edges and are pushed away
   */
  private calculateBorderRepulsion(x: number, y: number, polygon: [number, number][], radius: number): { fx: number; fy: number } {
    let fx = 0
    let fy = 0
    const repulsionDistance = radius * 3  // Distance at which repulsion starts
    const repulsionStrength = 2.5  // How strong the push is

    // Check distance to each polygon edge
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i]
      const p2 = polygon[(i + 1) % polygon.length]

      // Calculate distance from point to line segment
      const dist = this.pointToSegmentDistance(x, y, p1, p2)

      if (dist < repulsionDistance) {
        // Calculate perpendicular direction away from edge
        const edgeVec = [p2[0] - p1[0], p2[1] - p1[1]]
        const edgeLen = Math.sqrt(edgeVec[0] ** 2 + edgeVec[1] ** 2)

        if (edgeLen > 0) {
          // Normal vector (perpendicular to edge)
          const normalX = -edgeVec[1] / edgeLen
          const normalY = edgeVec[0] / edgeLen

          // Project point onto edge to determine which side
          const t = Math.max(0, Math.min(1, ((x - p1[0]) * edgeVec[0] + (y - p1[1]) * edgeVec[1]) / (edgeLen * edgeLen)))
          const projX = p1[0] + t * edgeVec[0]
          const projY = p1[1] + t * edgeVec[1]

          // Determine direction to push (away from edge)
          const toPointX = x - projX
          const toPointY = y - projY
          const sign = toPointX * normalX + toPointY * normalY > 0 ? 1 : -1

          // Apply repulsion force (inverse square law)
          const force = repulsionStrength * (1 - dist / repulsionDistance)
          fx += sign * normalX * force
          fy += sign * normalY * force
        }
      }
    }

    return { fx, fy }
  }

  /**
   * Calculate distance from point to line segment
   */
  private pointToSegmentDistance(px: number, py: number, p1: [number, number], p2: [number, number]): number {
    const dx = p2[0] - p1[0]
    const dy = p2[1] - p1[1]
    const lenSq = dx * dx + dy * dy

    if (lenSq === 0) return Math.sqrt((px - p1[0]) ** 2 + (py - p1[1]) ** 2)

    let t = ((px - p1[0]) * dx + (py - p1[1]) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))

    const projX = p1[0] + t * dx
    const projY = p1[1] + t * dy

    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
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
