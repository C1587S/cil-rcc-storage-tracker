import { Target, Folder, Files, FileText, HardDrive, BarChart3, Focus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/utils/formatters'
import { getSizeSeverity, getFileCountSeverity, getQuotaTextColor } from '@/lib/voronoi/utils/colors'
import { FILE_COUNT_QUOTA } from '@/lib/voronoi/utils/constants'
import { type PartitionInfo } from '@/lib/voronoi/utils/types'

interface VoronoiPartitionPanelProps {
  activePartition: PartitionInfo | null
  selectedFileInPanel: string | null
  onFileClick: (filePath: string) => void
  isExpanded?: boolean
  isFullscreen?: boolean
}

export function VoronoiPartitionPanel({
  activePartition,
  selectedFileInPanel,
  onFileClick,
  isExpanded = false,
  isFullscreen = false
}: VoronoiPartitionPanelProps) {
  // Scale text based on view mode
  const textScale = isFullscreen ? 1.3 : isExpanded ? 1.15 : 1

  return (
    <div className="flex-1 bg-[#161b22] border border-gray-800 rounded-lg overflow-hidden h-[320px] flex flex-col">
      <div className="bg-gray-800/50 px-3 py-2 border-b border-gray-700 flex items-center gap-2 shrink-0">
        <Target className="w-4 h-4 text-cyan-400" />
        <span className="font-bold text-white uppercase tracking-wider" style={{ fontSize: `${10 * textScale}px` }}>Partition Info</span>
      </div>

      <div className="p-3 overflow-y-auto flex-1">
        {activePartition ? (
          <div className="space-y-3">
            <div className="flex items-start gap-4">
              <div className="flex items-center gap-2">
                {activePartition.isSynthetic ? <Files className="w-6 h-6 text-blue-400" /> : activePartition.isDirectory ? <Folder className="w-6 h-6 text-green-400" /> : <FileText className="w-6 h-6 text-gray-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold truncate" style={{ fontSize: `${14 * textScale}px` }}>{activePartition.name}</p>
                <p className="text-gray-500 truncate" style={{ fontSize: `${10 * textScale}px` }}>{activePartition.path}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                <div className="flex items-center gap-1 mb-1"><HardDrive className="w-3 h-3 text-gray-600" /><label className="text-gray-600" style={{ fontSize: `${9 * textScale}px` }}>SIZE</label></div>
                <div className={cn("font-bold", getSizeSeverity(activePartition.size).color)} style={{ fontSize: `${14 * textScale}px` }}>{formatBytes(activePartition.size)}</div>
              </div>
              <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                <div className="flex items-center gap-1 mb-1"><BarChart3 className="w-3 h-3 text-gray-600" /><label className="text-gray-600" style={{ fontSize: `${9 * textScale}px` }}>STORAGE QUOTA</label></div>
                <div className={cn("font-bold", getQuotaTextColor(activePartition.quotaPercent))} style={{ fontSize: `${14 * textScale}px` }}>{activePartition.quotaPercent.toFixed(2)}%</div>
                <div className="text-gray-500" style={{ fontSize: `${9 * textScale}px` }}>of 500 TB</div>
              </div>
              <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                <div className="flex items-center gap-1 mb-1"><Files className="w-3 h-3 text-gray-600" /><label className="text-gray-600" style={{ fontSize: `${9 * textScale}px` }}>FILE COUNT</label></div>
                <div className={cn("font-bold", getFileCountSeverity(activePartition.file_count).color)} style={{ fontSize: `${14 * textScale}px` }}>{activePartition.file_count > 0 ? activePartition.file_count.toLocaleString() : '—'}</div>
              </div>
              <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                <div className="flex items-center gap-1 mb-1"><BarChart3 className="w-3 h-3 text-gray-600" /><label className="text-gray-600" style={{ fontSize: `${9 * textScale}px` }}>FILE QUOTA</label></div>
                <div className={cn("font-bold", getQuotaTextColor(activePartition.fileQuotaPercent))} style={{ fontSize: `${14 * textScale}px` }}>{activePartition.fileQuotaPercent.toFixed(3)}%</div>
                <div className="text-gray-500" style={{ fontSize: `${9 * textScale}px` }}>of {(FILE_COUNT_QUOTA / 1_000_000).toFixed(0)}M</div>
              </div>
            </div>

            {activePartition.parentQuotaPercent !== undefined && activePartition.parentQuotaPercent < 100 && (
              <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                <div className="flex items-center gap-1 mb-1"><BarChart3 className="w-3 h-3 text-gray-600" /><label className="text-gray-600" style={{ fontSize: `${9 * textScale}px` }}>% OF CURRENT DIR</label></div>
                <div className={cn("font-bold", getQuotaTextColor(activePartition.parentQuotaPercent))} style={{ fontSize: `${14 * textScale}px` }}>{activePartition.parentQuotaPercent.toFixed(1)}%</div>
              </div>
            )}

            {/* Show files for ANY node with originalFiles (not just synthetic nodes) */}
            {activePartition.originalFiles && activePartition.originalFiles.length > 0 && (() => {
              const maxFileSize = Math.max(...activePartition.originalFiles.map(f => f.size))
              return (
                <div className="bg-black/30 px-3 py-2 rounded border border-gray-800 max-h-64 overflow-y-auto">
                  <div className="text-gray-500 uppercase mb-2" style={{ fontSize: `${9 * textScale}px` }}>Files in this region ({activePartition.originalFiles.length}):</div>
                  <div className="space-y-1">
                    {activePartition.originalFiles.map((file, idx) => {
                      const sizePercent = maxFileSize > 0 ? (file.size / maxFileSize) * 100 : 0
                      return (
                        <div key={idx} onClick={() => onFileClick(file.path)} className={cn("flex flex-col gap-1 p-1 rounded hover:bg-cyan-950/30 cursor-pointer transition-colors", selectedFileInPanel === file.path && "bg-cyan-950/50 border border-cyan-700")}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-white truncate flex-1" style={{ fontSize: `${10 * textScale}px` }}>{file.name}</span>
                            <span className="text-gray-400 whitespace-nowrap" style={{ fontSize: `${9 * textScale}px` }}>{formatBytes(file.size)}</span>
                          </div>
                          <div className="h-1 bg-gray-900/50 rounded-full overflow-hidden">
                            <div className="h-full bg-cyan-500/60 transition-all" style={{ width: `${sizePercent}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

          </div>
        ) : (
          <div className="flex items-center gap-3 text-gray-600 py-2"><Focus className="w-5 h-5" /><span className="italic" style={{ fontSize: `${12 * textScale}px` }}>Hover or right-click a partition to view details</span></div>
        )}
      </div>
    </div>
  )
}
