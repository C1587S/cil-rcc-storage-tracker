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

export interface VoronoiRendererOptions {
  svgRef: React.RefObject<SVGSVGElement>
  containerRef: React.RefObject<HTMLDivElement>
  tooltipRef: React.RefObject<HTMLDivElement>
  voronoiCacheRef: React.RefObject<Map<string, VoronoiCacheEntry>>
  zoomRef: React.MutableRefObject<any>
  isFullscreen: boolean
  highlightColor: string
  theme: 'dark' | 'light'
  getPartitionQuotaPercent: (size: number) => number
  getFileQuotaPercent: (fileCount: number) => number
  getParentQuotaPercent: (size: number) => number
  parentSize: number
  selectedPartition: PartitionInfo | null
  setHoveredPartition: (info: PartitionInfo | null) => void
  handleInspect: (info: PartitionInfo) => void
  performDrillDown: (path: string) => void
  onRenderComplete?: () => void
}

export class VoronoiRenderer {
  private options: VoronoiRendererOptions
  private computer: VoronoiComputer | null = null
  private bubbleLayer: BubbleLayer | null = null
  private simulation: d3.Simulation<any, undefined> | null = null

  constructor(options: VoronoiRendererOptions) {
    this.options = options
  }

  render(data: VoronoiNode, effectivePath: string): void {
    const { svgRef, containerRef, voronoiCacheRef } = this.options

    if (!svgRef.current || !containerRef.current || !voronoiCacheRef.current) {
      return
    }

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    if (this.simulation) {
      this.simulation.stop()
      this.simulation = null
    }

    this.renderInternal(data, effectivePath, width, height)
  }

  private renderInternal(data: VoronoiNode, effectivePath: string, width: number, height: number): void {
    const { svgRef, voronoiCacheRef, zoomRef, isFullscreen } = this.options

    // 1. SAFETY CHECK: Abortar si no hay dimensiones válidas.
    // Esto es crucial para evitar el "letterboxing" negro o errores de cálculo.
    if (!svgRef.current || !voronoiCacheRef.current || width === 0 || height === 0) return

    const svg = d3.select(svgRef.current)

    // 🔥 LIMPIEZA NUCLEAR: Resetear todo estado previo de D3
    svg.selectAll('*').remove()
    svg.attr('viewBox', null)
    
    // TRUCO CRÍTICO: Eliminar la propiedad interna __zoom de D3 del nodo DOM.
    // Si no se hace esto, al cambiar el tamaño del contenedor, el zoom antiguo se aplica
    // al nuevo tamaño, causando que el gráfico se vea desplazado o gigante.
    if ((svgRef.current as any).__zoom) {
        delete (svgRef.current as any).__zoom;
    }

    // 2. FORZAR ESTILOS CSS
    // Aseguramos que el SVG ocupe exactamente el espacio disponible
    svg.attr('width', width)
       .attr('height', height)
       .style('width', '100%')
       .style('height', '100%')
       .style('display', 'block') // Evita el "gap" inferior de los elementos inline
       .style('background', TERMINAL_COLORS.background)

    const defs = svg.append('defs')
    
    // Crear el grupo raíz
    const gRoot = svg.append('g').attr('id', 'voronoi-root')
    
    // Resetear transformación explícitamente
    gRoot.attr('transform', 'translate(0,0) scale(1)')

    // Crear capas (Orden de apilamiento importa - labels deben estar encima de interaction para permitir hover)
    const gBackgrounds = gRoot.append('g').attr('class', 'layer-backgrounds')
    const gPreview = gRoot.append('g').attr('class', 'layer-preview')
    const gBubbles = gRoot.append('g').attr('class', 'layer-bubbles')
    const gInteraction = gRoot.append('g').attr('class', 'layer-interaction')
    const gLabels = gRoot.append('g').attr('class', 'layer-labels')

    // Configurar comportamiento de Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 10])
      .translateExtent([[0, 0], [width, height]])
      .extent([[0, 0], [width, height]])
      .on('zoom', (event) => {
          gRoot.attr('transform', event.transform)
      })

    svg.call(zoom)
    // Reiniciar el zoom a la identidad (0,0 scale 1) en cada render limpio
    svg.call(zoom.transform, d3.zoomIdentity)

    zoomRef.current = zoom

    // Compute Voronoi geometry
    this.computer = new VoronoiComputer(voronoiCacheRef.current)
    const { allNodes, topLevelNodes, previewNodes } = this.computer.compute(
      data,
      effectivePath,
      width,
      height
    )

    this.createClipPaths(defs, allNodes)

    // Render layers
    const backgroundLayer = new BackgroundLayer({ gBackgrounds, topLevelNodes })
    backgroundLayer.render(topLevelNodes)

    const previewLayer = new PreviewLayer({ gPreview, previewNodes })
    previewLayer.render(previewNodes)

    this.bubbleLayer = new BubbleLayer({
      gBubbles,
      topLevelNodes,
      tooltipRef: this.options.tooltipRef,
      highlightColor: this.options.highlightColor,
      theme: this.options.theme
    })

    const nodesForBubbles = [...topLevelNodes, ...previewNodes]
    this.simulation = this.bubbleLayer.render(nodesForBubbles)

    const labelLayer = new LabelLayer({ gLabels, topLevelNodes, viewportWidth: width, isFullscreen })
    labelLayer.render(topLevelNodes)

    const interactionLayer = new InteractionLayer({
      gInteraction,
      gBackgrounds,
      topLevelNodes,
      highlightColor: this.options.highlightColor,
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

    if (this.options.onRenderComplete) {
      this.options.onRenderComplete()
    }
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

  getSimulation(): d3.Simulation<any, undefined> | null {
    return this.simulation
  }
}