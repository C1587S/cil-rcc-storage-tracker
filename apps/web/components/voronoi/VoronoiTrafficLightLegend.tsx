import { useAppStore } from '@/lib/store'

interface VoronoiTrafficLightLegendProps {
  isExpanded?: boolean
  isFullscreen?: boolean
}

export function VoronoiTrafficLightLegend({ isExpanded = false, isFullscreen = false }: VoronoiTrafficLightLegendProps) {
  const theme = useAppStore(state => state.theme)
  // Responsive text scaling
  const textScale = isFullscreen ? 1.3 : isExpanded ? 1.1 : 1
  const labelSize = Math.round(9 * textScale)
  const descSize = Math.round(8 * textScale)
  const dotSize = Math.round(10 * textScale)

  return (
    <div className={theme === 'dark' ? 'bg-[#0a0e14] border border-gray-800/50' : 'bg-card border border-border/30'} style={{ borderRadius: '0.5rem', padding: '0.5rem' }}>
      <div className="flex items-center gap-3">
        {/* Title on the left */}
        <div className={theme === 'dark' ? 'text-gray-600 font-bold uppercase whitespace-nowrap' : 'text-foreground/70 font-bold uppercase whitespace-nowrap'} style={{ fontSize: `${labelSize}px` }}>
          Partition Size:
        </div>

        {/* Values in single horizontal row */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <div className="rounded-full bg-green-400 flex-shrink-0" style={{ width: `${dotSize}px`, height: `${dotSize}px` }} />
            <span className={theme === 'dark' ? 'text-gray-300' : 'text-foreground/70'} style={{ fontSize: `${descSize}px` }}>0-10GB</span>
          </div>

          <div className="flex items-center gap-1">
            <div className="rounded-full bg-yellow-400 flex-shrink-0" style={{ width: `${dotSize}px`, height: `${dotSize}px` }} />
            <span className={theme === 'dark' ? 'text-gray-300' : 'text-foreground/70'} style={{ fontSize: `${descSize}px` }}>10-20GB</span>
          </div>

          <div className="flex items-center gap-1">
            <div className="rounded-full bg-orange-400 flex-shrink-0" style={{ width: `${dotSize}px`, height: `${dotSize}px` }} />
            <span className={theme === 'dark' ? 'text-gray-300' : 'text-foreground/70'} style={{ fontSize: `${descSize}px` }}>20-50GB</span>
          </div>

          <div className="flex items-center gap-1">
            <div className="rounded-full bg-red-500 flex-shrink-0" style={{ width: `${dotSize}px`, height: `${dotSize}px` }} />
            <span className={theme === 'dark' ? 'text-gray-300' : 'text-foreground/70'} style={{ fontSize: `${descSize}px` }}>&gt;50GB</span>
          </div>
        </div>
      </div>
    </div>
  )
}
