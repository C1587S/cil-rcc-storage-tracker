import { getAllSizeCategories } from '@/lib/voronoi/utils/bubble-sizes'
import { useAppStore } from '@/lib/store'

interface VoronoiBubbleSizeLegendProps {
  isExpanded?: boolean
  isFullscreen?: boolean
}

export function VoronoiBubbleSizeLegend({ isExpanded = false, isFullscreen = false }: VoronoiBubbleSizeLegendProps) {
  const theme = useAppStore(state => state.theme)
  const sizeCategories = getAllSizeCategories()

  // Responsive text scaling
  const textScale = isFullscreen ? 1.3 : isExpanded ? 1.1 : 1
  const labelSize = Math.round(9 * textScale)
  const descSize = Math.round(8 * textScale)

  // Show subset of categories for legend (every other one to avoid clutter)
  // In standard view: show 5 categories, expanded/fullscreen: show all 10
  const displayCategories = (isExpanded || isFullscreen)
    ? sizeCategories
    : sizeCategories.filter((_, idx) => idx % 2 === 0)  // Show 0, 2, 4, 6, 8 (5 categories)

  return (
    <div className={theme === 'dark' ? 'bg-[#0a0e14] border border-gray-800/50' : 'bg-card border border-border/30'} style={{ borderRadius: '0.5rem', padding: '0.5rem' }}>
      <div className="flex items-center gap-3">
        {/* Title on the left */}
        <div className={theme === 'dark' ? 'text-gray-600 font-bold uppercase whitespace-nowrap' : 'text-foreground/70 font-bold uppercase whitespace-nowrap'} style={{ fontSize: `${labelSize}px` }}>
          Size:
        </div>

        {/* Values in single horizontal row */}
        <div className="flex items-center gap-2">
          {displayCategories.map((category, idx) => {
            const svgSize = category.radius * 2 + 4  // Add padding
            return (
              <div key={idx} className="flex items-center gap-1">
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
                <span className={theme === 'dark' ? 'text-gray-300' : 'text-foreground/70'} style={{ fontSize: `${descSize}px` }}>
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
