import { useState, useCallback, useRef, useEffect } from 'react'
import * as d3 from 'd3'

export function useVoronoiZoom() {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const zoomRef = useRef<any>(null)

  // Listen to browser fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  const resetZoom = useCallback((svgRef: React.RefObject<SVGSVGElement>) => {
    if (zoomRef.current && svgRef.current) {
      d3.select(svgRef.current).transition().duration(500).call(zoomRef.current.transform, d3.zoomIdentity)
    }
  }, [])

  const toggleFullscreen = useCallback(async (wrapperRef: React.RefObject<HTMLDivElement>) => {
    if (!wrapperRef.current) return
    try {
      if (!document.fullscreenElement) {
        await wrapperRef.current.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch (e) {
      console.error('Fullscreen error:', e)
    }
  }, [])

  return {
    isFullscreen,
    zoomRef,
    resetZoom,
    toggleFullscreen,
  }
}
