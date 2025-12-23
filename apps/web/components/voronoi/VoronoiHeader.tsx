import { formatBytes } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils'
import { getQuotaColor, getQuotaTextColor } from '@/lib/voronoi/utils/colors'
import { STORAGE_QUOTA_TB } from '@/lib/voronoi/utils/constants'

interface VoronoiHeaderProps {
  selectedSnapshot: string | null
  projectSize: number
  storageQuotaPercent: number
  viewingPath: string | null
  parentSize: number
}

export function VoronoiHeader({
  selectedSnapshot,
  projectSize,
  storageQuotaPercent,
  viewingPath,
  parentSize
}: VoronoiHeaderProps) {
  return (
    <div className="flex flex-col border-b border-gray-800 pb-3 gap-3">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">Storage Voronoi Topology</h2>
          <p className="text-gray-500">{selectedSnapshot} · Snapshot Data</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 whitespace-nowrap text-[10px]">GLOBAL QUOTA:</span>
          <div className="flex-1 h-2 bg-gray-900 rounded-full overflow-hidden border border-gray-800">
            <div className={cn("h-full transition-all duration-1000", getQuotaColor(storageQuotaPercent))} style={{ width: `${Math.min(storageQuotaPercent, 100)}%` }} />
          </div>
          <span className={cn("font-bold min-w-[50px] text-right text-[10px]", getQuotaTextColor(storageQuotaPercent))}>{storageQuotaPercent.toFixed(1)}%</span>
          <span className="text-gray-600 text-[9px]">({formatBytes(projectSize)} / {STORAGE_QUOTA_TB}TB)</span>
        </div>

        {viewingPath && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500 whitespace-nowrap text-[10px]">CURRENT DIR:</span>
            <div className="flex-1 h-2 bg-gray-900 rounded-full overflow-hidden border border-gray-800">
              <div className="h-full bg-cyan-600/70 transition-all duration-1000" style={{ width: '100%' }} />
            </div>
            <span className="font-bold min-w-[50px] text-right text-[10px] text-cyan-400">100%</span>
            <span className="text-gray-600 text-[9px]">({formatBytes(parentSize)})</span>
          </div>
        )}
      </div>
    </div>
  )
}
