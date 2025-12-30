import { formatBytes } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils'
import { getQuotaColor, getQuotaTextColor } from '@/lib/voronoi/utils/colors'
import { STORAGE_QUOTA_TB } from '@/lib/voronoi/utils/constants'
import { useAppStore } from '@/lib/store'

interface VoronoiHeaderProps {
  selectedSnapshot: string | null
  projectSize: number
  storageQuotaPercent: number
  viewingPath: string | null
  parentSize: number
  isFullscreen?: boolean
}

export function VoronoiHeader({
  selectedSnapshot,
  projectSize,
  storageQuotaPercent,
  viewingPath,
  parentSize,
  isFullscreen = false
}: VoronoiHeaderProps) {
  const theme = useAppStore(state => state.theme)

  return (
    <div className={cn(
      "flex flex-col pb-3 gap-3 border-b",
      theme === 'dark' ? 'border-gray-800' : 'border-border/30'
    )}>
      {!isFullscreen && (
        <div className="flex justify-between items-start">
          <div>
            <p className={theme === 'dark' ? 'text-gray-500' : 'text-muted-foreground'}>{selectedSnapshot}</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={cn(
            "whitespace-nowrap text-[10px]",
            theme === 'dark' ? 'text-gray-500' : 'text-muted-foreground/70'
          )}>GLOBAL QUOTA:</span>
          <div className={cn(
            "flex-1 h-2 rounded-full overflow-hidden border",
            theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-muted/30 border-border/30'
          )}>
            <div className={cn("h-full transition-all duration-1000", getQuotaColor(storageQuotaPercent))} style={{ width: `${Math.min(storageQuotaPercent, 100)}%` }} />
          </div>
          <span className={cn("font-bold min-w-[50px] text-right text-[10px]", getQuotaTextColor(storageQuotaPercent))}>{storageQuotaPercent.toFixed(1)}%</span>
          <span className={cn(
            "text-[9px]",
            theme === 'dark' ? 'text-gray-600' : 'text-muted-foreground/60'
          )}>({formatBytes(projectSize)} / {STORAGE_QUOTA_TB}TB)</span>
        </div>

        {viewingPath && (() => {
          const currentDirQuotaPercent = (parentSize / (STORAGE_QUOTA_TB * 1024**4)) * 100
          return (
            <div className="flex items-center gap-2">
              <span className={cn(
                "whitespace-nowrap text-[10px]",
                theme === 'dark' ? 'text-gray-500' : 'text-muted-foreground/70'
              )}>CURRENT DIR:</span>
              <div className={cn(
                "flex-1 h-2 rounded-full overflow-hidden border",
                theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-muted/30 border-border/30'
              )}>
                <div className={cn("h-full transition-all duration-1000", getQuotaColor(currentDirQuotaPercent))} style={{ width: `${Math.min(currentDirQuotaPercent, 100)}%` }} />
              </div>
              <span className={cn("font-bold min-w-[50px] text-right text-[10px]", getQuotaTextColor(currentDirQuotaPercent))}>{currentDirQuotaPercent.toFixed(1)}%</span>
              <span className={cn(
                "text-[9px]",
                theme === 'dark' ? 'text-gray-600' : 'text-muted-foreground/60'
              )}>({formatBytes(parentSize)})</span>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
