import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BreadcrumbPart {
  name: string
  path: string
  isClickable: boolean
}

interface VoronoiBreadcrumbProps {
  breadcrumbParts: BreadcrumbPart[]
  canGoBack: boolean
  isLocked: boolean
  onNavigateBack: () => void
  onNavigateToBreadcrumb: (path: string) => void
}

export function VoronoiBreadcrumb({
  breadcrumbParts,
  canGoBack,
  isLocked,
  onNavigateBack,
  onNavigateToBreadcrumb
}: VoronoiBreadcrumbProps) {
  return (
    <div className="bg-[#0a0e14] border border-gray-800 p-2 rounded flex items-center gap-2 overflow-x-auto">
      <button onClick={onNavigateBack} disabled={!canGoBack || isLocked} className={cn("flex items-center justify-center w-7 h-7 rounded border transition-all shrink-0", canGoBack && !isLocked ? "border-gray-700 hover:border-cyan-600 hover:bg-cyan-950/30 text-gray-400 hover:text-cyan-400 cursor-pointer" : "border-gray-800 text-gray-700 cursor-not-allowed")} title="Go back">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-gray-700">|</span>
      <span className="text-green-500 font-bold">$</span>
      {breadcrumbParts.map((part, i) => (
        <div key={`${part.path}-${i}`} className="flex items-center gap-1">
          <button onClick={() => part.isClickable && !isLocked && onNavigateToBreadcrumb(part.path)} disabled={!part.isClickable || isLocked} className={cn("transition-colors whitespace-nowrap", part.isClickable && !isLocked ? "hover:text-cyan-400 text-gray-400 cursor-pointer" : "text-white cursor-default font-bold")}>
            {part.name}
          </button>
          {i < breadcrumbParts.length - 1 && <span className="text-gray-700">/</span>}
        </div>
      ))}
    </div>
  )
}
