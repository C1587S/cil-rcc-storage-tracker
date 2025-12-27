import { getAllSizeCategories } from '@/lib/voronoi/utils/bubble-sizes'

interface VoronoiBubbleSizeLegendProps {
  isExpanded?: boolean
  isFullscreen?: boolean
}

export function VoronoiBubbleSizeLegend({ isExpanded = false, isFullscreen = false }: VoronoiBubbleSizeLegendProps) {
  const sizeCategories = getAllSizeCategories()

  // Responsive text scaling
  const textScale = isFullscreen ? 1.3 : isExpanded ? 1.1 : 1
  const labelSize = Math.round(10 * textScale)
  const descSize = Math.round(9 * textScale)

  // Show subset of categories for legend (every other one to avoid clutter)
  // In standard view: show 5 categories, expanded/fullscreen: show all 10
  const displayCategories = (isExpanded || isFullscreen)
    ? sizeCategories
    : sizeCategories.filter((_, idx) => idx % 2 === 0)  // Show 0, 2, 4, 6, 8 (5 categories)

  return (
    <div className="bg-[#0a0e14] border border-gray-800/50 rounded-lg p-4">
      <div className="flex items-center gap-6">
        <span className="text-gray-600 font-bold uppercase whitespace-nowrap" style={{ fontSize: `${labelSize}px` }}>Bubble Size:</span>

        <div className="flex items-center justify-center gap-4 flex-wrap flex-1">
          {displayCategories.map((category, idx) => {
            const svgSize = category.radius * 2 + 4  // Add padding
            return (
              <div key={idx} className="flex items-center gap-2">
                <svg width={svgSize} height={svgSize} viewBox={`0 0 ${svgSize} ${svgSize}`}>
                  <circle
                    cx={svgSize / 2}
                    cy={svgSize / 2}
                    r={category.radius}
                    fill="#4b5563"
                    stroke="white"
                    strokeWidth="1"
                    opacity="0.7"
                  />
                </svg>
                <span className="text-gray-300" style={{ fontSize: `${descSize}px` }}>
                  {category.description}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
