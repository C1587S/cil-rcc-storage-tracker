import { useState, useCallback, useRef } from 'react'
import * as d3 from 'd3'

export function useVoronoiZoom() {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const zoomRef = useRef<any>(null)

  const resetZoom = useCallback((svgRef: React.RefObject<SVGSVGElement>) => {
    if (zoomRef.current && svgRef.current) {
      d3.select(svgRef.current).transition().duration(500).call(zoomRef.current.transform, d3.zoomIdentity)
    }
  }, [])

  const toggleFullscreen = useCallback(async (wrapperRef: React.RefObject<HTMLDivElement>) => {
    if (!wrapperRef.current) return
    try {
      if (!isFullscreen) {
        await wrapperRef.current.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    } catch (e) {
      console.error('Fullscreen error:', e)
    }
  }, [isFullscreen])

  return {
    isFullscreen,
    zoomRef,
    resetZoom,
    toggleFullscreen,
  }
}
