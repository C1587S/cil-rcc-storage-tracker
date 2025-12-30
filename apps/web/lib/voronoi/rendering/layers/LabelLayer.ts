import * as d3 from 'd3'
import { TERMINAL_COLORS } from '@/lib/voronoi/utils/constants'
import { getPolygonBounds } from '@/lib/voronoi/utils/geometry'

export interface LabelLayerOptions {
  gLabels: d3.Selection<SVGGElement, unknown, null, undefined>
  topLevelNodes: d3.HierarchyNode<any>[]
  viewportWidth: number
  isFullscreen: boolean
  theme: 'dark' | 'light'
}

export class LabelLayer {
  private gLabels: d3.Selection<SVGGElement, unknown, null, undefined>
  private viewportWidth: number
  private isFullscreen: boolean
  private theme: 'dark' | 'light'

  constructor(options: LabelLayerOptions) {
    this.gLabels = options.gLabels
    this.viewportWidth = options.viewportWidth
    this.isFullscreen = options.isFullscreen
    this.theme = options.theme
  }

  render(topLevelNodes: d3.HierarchyNode<any>[]): void {
    // Smaller base font size for cleaner look
    const baseWidth = 1278
    const baseFontSizeMax = 10  // Reduced from 13 to 10
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
        const fullName = node.isSynthetic ? `${node.file_count} files` : node.name
        const isTruncated = !node.isSynthetic && node.name.length > 20
        const displayName = isTruncated ? node.name.slice(0, 17) + '...' : fullName
        const fontSize = Math.min(maxFontSize, Math.max(7, bounds.width / displayName.length * 1.2 * fontSizeScale))

        // Calculate text bounding box for background
        const textWidth = displayName.length * fontSize * 0.6
        const textHeight = fontSize * 1.4
        const padding = 4

        // Theme-aware colors
        const isDark = this.theme === 'dark'
        const bgColor = isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.85)'
        const shadowColor = isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.25)'
        const textColor = node.isSynthetic
          ? (isDark ? TERMINAL_COLORS.filesContainer : '#0066cc')  // Blue for synthetic in light mode
          : (isDark ? '#b0b0b0' : '#1a1a1a')  // Almost black for light mode
        const strokeColor = isDark ? 'white' : 'rgba(255, 255, 255, 0.9)'
        const shadowFilter = isDark
          ? 'drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.3))'
          : 'drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.2))'

        // Add subtle background rectangle
        this.gLabels.append('rect')
          .attr('x', centroid[0] - textWidth / 2 - padding)
          .attr('y', centroid[1] - textHeight / 2 - padding)
          .attr('width', textWidth + padding * 2)
          .attr('height', textHeight + padding * 2)
          .attr('rx', 3)
          .attr('ry', 3)
          .attr('fill', bgColor)
          .style('pointer-events', 'none')

        // Add subtle shadow for improved visibility
        this.gLabels.append('text')
          .attr('x', centroid[0])
          .attr('y', centroid[1] + 0.5)  // Slight offset for shadow
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('fill', shadowColor)
          .attr('font-size', fontSize)
          .attr('font-weight', '600')
          .attr('font-family', 'monospace')
          .style('pointer-events', 'none')
          .text(displayName)

        // Main text with stroke outline and hover effects
        this.gLabels.append('text')
          .attr('x', centroid[0])
          .attr('y', centroid[1])
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('fill', textColor)
          .attr('stroke', strokeColor)
          .attr('stroke-width', 0.5)
          .attr('font-size', fontSize)
          .attr('font-weight', '600')
          .attr('font-family', 'monospace')
          .attr('data-base-size', fontSize)  // Store base font size
          .attr('data-full-name', fullName)  // Store full name for hover
          .attr('data-is-truncated', isTruncated ? 'true' : 'false')  // Store truncation state
          .style('pointer-events', 'all')  // Enable hover
          .style('cursor', 'pointer')
          .style('paint-order', 'stroke fill')
          .style('filter', shadowFilter)
          .style('transition', 'all 0.2s ease')
          .text(displayName)
          .on('mouseenter', function(event: MouseEvent) {
            const baseSize = parseFloat(d3.select(this).attr('data-base-size'))
            const fullNameAttr = d3.select(this).attr('data-full-name')
            const isTrunc = d3.select(this).attr('data-is-truncated') === 'true'

            // Trigger partition highlight by simulating mouseenter on interaction overlay
            const overlayPath = `.voronoi-interaction-overlay[data-path="${node.path}"]`
            const overlay = d3.select(overlayPath).node() as Element | null
            if (overlay) {
              const syntheticEvent = new MouseEvent('mouseenter', {
                bubbles: true,
                cancelable: true,
                view: window,
                relatedTarget: event.target as Element
              })
              overlay.dispatchEvent(syntheticEvent)
            }

            d3.select(this)
              .attr('font-size', baseSize * 1.2)  // Grow 20%
              .attr('text-decoration', 'underline')
              .style('filter', 'drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.5))')

            // Show full name if truncated
            if (isTrunc && fullNameAttr) {
              d3.select(this).text(fullNameAttr)
            }
          })
          .on('mouseleave', function(event: MouseEvent) {
            const baseSize = parseFloat(d3.select(this).attr('data-base-size'))
            const isTrunc = d3.select(this).attr('data-is-truncated') === 'true'
            const fullNameAttr = d3.select(this).attr('data-full-name')
            const displayNameStored = isTrunc && fullNameAttr ? fullNameAttr.slice(0, 17) + '...' : fullNameAttr

            // Trigger partition un-highlight
            const overlayPath = `.voronoi-interaction-overlay[data-path="${node.path}"]`
            const overlay = d3.select(overlayPath).node() as Element | null
            if (overlay) {
              const syntheticEvent = new MouseEvent('mouseleave', {
                bubbles: true,
                cancelable: true,
                view: window,
                relatedTarget: event.target as Element
              })
              overlay.dispatchEvent(syntheticEvent)
            }

            d3.select(this)
              .attr('font-size', baseSize)
              .attr('text-decoration', 'none')
              .style('filter', 'drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.3))')
              .text(displayNameStored || '')  // Restore truncated version
          })
      }
    })
  }
}
