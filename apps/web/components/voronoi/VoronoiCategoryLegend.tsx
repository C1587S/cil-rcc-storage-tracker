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
import { useAppStore } from '@/lib/store'

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
  const theme = useAppStore(state => state.theme)
  const categories = getAllCategories()

  // Responsive text scaling based on view mode
  // Smaller icons for compact layout - reduce scaling in fullscreen to prevent cutoff
  const textScale = isFullscreen ? 1.0 : isExpanded ? 1.1 : 1
  const labelSize = Math.round(9 * textScale)
  const nameSize = Math.round(8 * textScale)
  const iconSize = Math.round(11 * textScale)

  return (
    <div className={theme === 'dark' ? 'bg-[#0a0e14] border border-gray-800/50' : 'bg-card border border-border/30'} style={{ borderRadius: '0.5rem', padding: '0.5rem' }}>
      <div className="flex flex-col gap-2">
        {/* Title - centered */}
        <div className={theme === 'dark' ? 'text-center text-gray-600 font-bold uppercase' : 'text-center text-foreground/70 font-bold uppercase'} style={{ fontSize: `${labelSize}px` }}>
          File Categories
        </div>

        {/* Category items - 2 rows of 5 elements */}
        <div className="grid grid-cols-5 gap-2">
          {categories.map((category) => {
            const info = CATEGORY_INFO[category]
            const Icon = CATEGORY_ICONS[category]

            return (
              <div
                key={category}
                className="flex items-center gap-1 group relative cursor-help"
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
                <div style={{ width: `${iconSize}px`, height: `${iconSize}px` }} className="flex-shrink-0">
                  <Icon className="text-gray-400 w-full h-full" />
                </div>

                {/* Category name - inline */}
                <span className={theme === 'dark' ? 'font-semibold text-gray-300 whitespace-nowrap' : 'font-semibold text-foreground/80 whitespace-nowrap'} style={{ fontSize: `${nameSize}px` }}>
                  {info.name}
                </span>

                {/* Tooltip on hover - appears above */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black/90 border border-gray-700 rounded text-gray-300 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-10" style={{ fontSize: `${Math.round(7 * textScale)}px` }}>
                  {info.examples.join(', ')}
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-black/90" />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
