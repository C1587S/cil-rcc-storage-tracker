interface VoronoiTrafficLightLegendProps {
  isExpanded?: boolean
  isFullscreen?: boolean
}

export function VoronoiTrafficLightLegend({ isExpanded = false, isFullscreen = false }: VoronoiTrafficLightLegendProps) {
  // Responsive text scaling
  const textScale = isFullscreen ? 1.3 : isExpanded ? 1.1 : 1
  const labelSize = Math.round(10 * textScale)
  const descSize = Math.round(9 * textScale)
  const dotSize = Math.round(12 * textScale)

  return (
    <div className="bg-[#0a0e14] border border-gray-800/50 rounded-lg p-4">
      <div className="flex items-center gap-6">
        <span className="text-gray-600 font-bold uppercase whitespace-nowrap" style={{ fontSize: `${labelSize}px` }}>Quota/Size Indicators:</span>

        <div className="flex items-center justify-center gap-6 flex-1">
          {/* Critical */}
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-red-600 flex-shrink-0" style={{ width: `${dotSize}px`, height: `${dotSize}px` }} />
            <span className="text-gray-300" style={{ fontSize: `${descSize}px` }}>Critical (&ge; 95%)</span>
          </div>

          {/* High */}
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-orange-500 flex-shrink-0" style={{ width: `${dotSize}px`, height: `${dotSize}px` }} />
            <span className="text-gray-300" style={{ fontSize: `${descSize}px` }}>High (75-95%)</span>
          </div>

          {/* Medium */}
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-yellow-400 flex-shrink-0" style={{ width: `${dotSize}px`, height: `${dotSize}px` }} />
            <span className="text-gray-300" style={{ fontSize: `${descSize}px` }}>Medium (50-75%)</span>
          </div>

          {/* Normal */}
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-green-600 flex-shrink-0" style={{ width: `${dotSize}px`, height: `${dotSize}px` }} />
            <span className="text-gray-300" style={{ fontSize: `${descSize}px` }}>Normal (&lt; 50%)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
