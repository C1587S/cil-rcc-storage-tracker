import * as d3 from 'd3'
import { type VoronoiNode } from '@/lib/voronoi-data-adapter'
import { type PartitionInfo, type VoronoiCacheEntry } from '@/lib/voronoi/utils/types'
import { TERMINAL_COLORS } from '@/lib/voronoi/utils/constants'
import { VoronoiComputer } from './VoronoiComputer'
import { BackgroundLayer } from './layers/BackgroundLayer'
import { PreviewLayer } from './layers/PreviewLayer'
import { BubbleLayer } from './layers/BubbleLayer'
import { LabelLayer } from './layers/LabelLayer'
import { InteractionLayer } from './layers/InteractionLayer'

/**
 * Options for configuring the VoronoiRenderer
 */
export interface VoronoiRendererOptions {
  svgRef: React.RefObject<SVGSVGElement>
  containerRef: React.RefObject<HTMLDivElement>
  tooltipRef: React.RefObject<HTMLDivElement>
  voronoiCacheRef: React.RefObject<Map<string, VoronoiCacheEntry>>
  zoomRef: React.MutableRefObject<any>
  isFullscreen: boolean
  getPartitionQuotaPercent: (size: number) => number
  getFileQuotaPercent: (fileCount: number) => number
  getParentQuotaPercent: (size: number) => number
  parentSize: number
  selectedPartition: PartitionInfo | null
  setHoveredPartition: (info: PartitionInfo | null) => void
  handleInspect: (info: PartitionInfo) => void
  performDrillDown: (path: string) => void
}

/**
 * Orchestrates the rendering of voronoi treemap visualization.
 * Manages multiple rendering layers (background, preview, bubbles, labels, interaction)
 * and handles the complete rendering pipeline from data computation to SVG output.
 */
export class VoronoiRenderer {
  private options: VoronoiRendererOptions
  private computer: VoronoiComputer | null = null
  private bubbleLayer: BubbleLayer | null = null
  private simulation: d3.Simulation<any, undefined> | null = null

  constructor(options: VoronoiRendererOptions) {
    this.options = options
  }

  /**
   * Main render method - orchestrates the entire rendering pipeline
   *
   * @param data - The hierarchical voronoi data to render
   * @param effectivePath - Current path being visualized
   */
  render(data: VoronoiNode, effectivePath: string): void {
    const { svgRef, containerRef, voronoiCacheRef, zoomRef, isFullscreen } = this.options

    if (!svgRef.current || !containerRef.current || !voronoiCacheRef.current) return

    // Stop previous simulation
    if (this.simulation) {
      this.simulation.stop()
      this.simulation = null
    }

    // Calculate dimensions
    const container = containerRef.current
    const width = container.clientWidth
    const height = isFullscreen ? window.innerHeight - 280 : 550
    if (width === 0) return

    // Setup SVG
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width)
      .attr('height', height)
      .style('background', TERMINAL_COLORS.background)

    // Create layer groups
    const defs = svg.append('defs')
    const gRoot = svg.append('g').attr('id', 'voronoi-root')
    const gBackgrounds = gRoot.append('g').attr('class', 'layer-backgrounds')
    const gPreview = gRoot.append('g').attr('class', 'layer-preview')
    const gBubbles = gRoot.append('g').attr('class', 'layer-bubbles')
    const gLabels = gRoot.append('g').attr('class', 'layer-labels')
    const gInteraction = gRoot.append('g').attr('class', 'layer-interaction')

    // Setup zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 10])
      .translateExtent([[0, 0], [width, height]])
      .extent([[0, 0], [width, height]])
      .on('zoom', (event) => gRoot.attr('transform', event.transform))

    svg.call(zoom)
    zoomRef.current = zoom

    // Compute voronoi hierarchy
    this.computer = new VoronoiComputer(voronoiCacheRef.current)
    const { allNodes, topLevelNodes, previewNodes } = this.computer.compute(
      data,
      effectivePath,
      width,
      height
    )

    // Create clip paths
    this.createClipPaths(defs, allNodes)

    // Render all layers in order
    const backgroundLayer = new BackgroundLayer({ gBackgrounds, topLevelNodes })
    backgroundLayer.render(topLevelNodes)

    const previewLayer = new PreviewLayer({ gPreview, previewNodes })
    previewLayer.render(previewNodes)

    this.bubbleLayer = new BubbleLayer({
      gBubbles,
      topLevelNodes,
      tooltipRef: this.options.tooltipRef
    })
    this.simulation = this.bubbleLayer.render(topLevelNodes)

    const labelLayer = new LabelLayer({ gLabels, topLevelNodes })
    labelLayer.render(topLevelNodes)

    const interactionLayer = new InteractionLayer({
      gInteraction,
      gBackgrounds,
      topLevelNodes,
      getPartitionQuotaPercent: this.options.getPartitionQuotaPercent,
      getFileQuotaPercent: this.options.getFileQuotaPercent,
      getParentQuotaPercent: this.options.getParentQuotaPercent,
      parentSize: this.options.parentSize,
      selectedPartition: this.options.selectedPartition,
      setHoveredPartition: this.options.setHoveredPartition,
      handleInspect: this.options.handleInspect,
      performDrillDown: this.options.performDrillDown
    })
    interactionLayer.render(topLevelNodes)
  }

  private createClipPaths(
    defs: d3.Selection<SVGDefsElement, unknown, null, undefined>,
    allNodes: d3.HierarchyNode<any>[]
  ): void {
    allNodes.forEach(d => {
      defs.append('clipPath')
        .attr('id', `clip-${d.data.uniqueId}`)
        .append('path')
        .attr('d', 'M' + (d as any).polygon.map((p: [number, number]) => p.join(',')).join('L') + 'Z')
    })
  }

  /**
   * Cleanup method - stops physics simulations and releases resources
   */
  cleanup(): void {
    if (this.bubbleLayer) {
      this.bubbleLayer.stop()
      this.bubbleLayer = null
    }
    if (this.simulation) {
      this.simulation.stop()
      this.simulation = null
    }
  }

  /**
   * Returns the current D3 physics simulation instance
   *
   * @returns The active simulation or null if not initialized
   */
  getSimulation(): d3.Simulation<any, undefined> | null {
    return this.simulation
  }
}
