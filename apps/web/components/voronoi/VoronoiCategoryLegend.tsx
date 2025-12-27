import {
  Database,
  FlaskConical,
  Image,
  FileText,
  Code,
  Cpu,
  Archive,
  Settings,
  Activity,
  MoreHorizontal
} from 'lucide-react'
import { CATEGORY_INFO, getAllCategories, type FileCategory } from '@/lib/voronoi/utils/file-categories'

const CATEGORY_ICONS: Record<FileCategory, React.ComponentType<{ className?: string }>> = {
  tabular: Database,
  scientific: FlaskConical,
  image: Image,
  document: FileText,
  code: Code,
  binary: Cpu,
  compressed: Archive,
  config: Settings,
  runtime: Activity,
  other: MoreHorizontal
}

interface VoronoiCategoryLegendProps {
  isExpanded?: boolean
  isFullscreen?: boolean
}

export function VoronoiCategoryLegend({ isExpanded = false, isFullscreen = false }: VoronoiCategoryLegendProps) {
  const categories = getAllCategories()

  // Responsive text scaling based on view mode
  // Smaller icons for compact layout - reduce scaling in fullscreen to prevent cutoff
  const textScale = isFullscreen ? 1.0 : isExpanded ? 1.1 : 1
  const labelSize = Math.round(10 * textScale)
  const nameSize = Math.round(9 * textScale)
  const iconSize = Math.round(12 * textScale)

  return (
    <div className="bg-[#0a0e14] border border-gray-800/50 rounded-lg p-3">
      <div className="flex flex-col gap-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-gray-600 font-bold uppercase whitespace-nowrap" style={{ fontSize: `${labelSize}px` }}>File Categories:</span>
        </div>

        {/* Category items - horizontal layout with wrapping */}
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {categories.map((category) => {
            const info = CATEGORY_INFO[category]
            const Icon = CATEGORY_ICONS[category]

            return (
              <div
                key={category}
                className="flex items-center gap-1.5 group relative cursor-help"
                title={info.description}  // Tooltip on hover
              >
                {/* Color box - smaller */}
                <div
                  className="rounded-sm flex-shrink-0"
                  style={{
                    backgroundColor: info.color,
                    width: `${iconSize}px`,
                    height: `${iconSize}px`
                  }}
                />

                {/* Icon - smaller */}
                <Icon className="text-gray-400 flex-shrink-0" style={{ width: `${iconSize}px`, height: `${iconSize}px` }} />

                {/* Category name - inline */}
                <span className="font-semibold text-gray-300 whitespace-nowrap" style={{ fontSize: `${nameSize}px` }}>
                  {info.name}
                </span>

                {/* Tooltip on hover - appears above */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black/90 border border-gray-700 rounded text-gray-300 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-10" style={{ fontSize: `${Math.round(8 * textScale)}px` }}>
                  {info.examples.join(', ')}
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-black/90" />
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer note */}
        <div className="text-center text-gray-600/70 italic" style={{ fontSize: `${Math.round(8 * textScale)}px` }}>
          Hover over categories for details
        </div>
      </div>
    </div>
  )
}
