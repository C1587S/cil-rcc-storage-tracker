import { Target, Folder, Files, FileText, HardDrive, BarChart3, Focus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/utils/formatters'
import { getSizeSeverity, getFileCountSeverity, getQuotaTextColor } from '@/lib/voronoi/utils/colors'
import { FILE_COUNT_QUOTA, STORAGE_QUOTA_TB } from '@/lib/voronoi/utils/constants'
import { type PartitionInfo } from '@/lib/voronoi/utils/types'

interface VoronoiPartitionPanelProps {
  activePartition: PartitionInfo | null
  selectedFileInPanel: string | null
  onFileClick: (filePath: string) => void
}

export function VoronoiPartitionPanel({
  activePartition,
  selectedFileInPanel,
  onFileClick
}: VoronoiPartitionPanelProps) {
  return (
    <div className="flex-1 bg-[#161b22] border border-gray-800 rounded-lg overflow-hidden h-[420px] flex flex-col">
      <div className="bg-gray-800/50 px-3 py-2 border-b border-gray-700 flex items-center gap-2 shrink-0">
        <Target className="w-4 h-4 text-cyan-400" />
        <span className="font-bold text-white uppercase text-[10px] tracking-wider">Partition Info</span>
      </div>

      <div className="p-3 overflow-y-auto flex-1">
        {activePartition ? (
          <div className="space-y-3">
            <div className="flex items-start gap-4">
              <div className="flex items-center gap-2">
                {activePartition.isSynthetic ? <Files className="w-6 h-6 text-blue-400" /> : activePartition.isDirectory ? <Folder className="w-6 h-6 text-green-400" /> : <FileText className="w-6 h-6 text-gray-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold truncate">{activePartition.name}</p>
                <p className="text-gray-500 text-[10px] truncate">{activePartition.path}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                <div className="flex items-center gap-1 mb-1"><HardDrive className="w-3 h-3 text-gray-600" /><label className="text-gray-600 text-[9px]">SIZE</label></div>
                <div className="text-cyan-400 font-bold text-sm">{formatBytes(activePartition.size)}</div>
                <div className={cn("text-[9px]", getSizeSeverity(activePartition.size).color)}>{getSizeSeverity(activePartition.size).label}</div>
              </div>
              <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                <div className="flex items-center gap-1 mb-1"><BarChart3 className="w-3 h-3 text-gray-600" /><label className="text-gray-600 text-[9px]">STORAGE QUOTA</label></div>
                <div className={cn("font-bold text-sm", getQuotaTextColor(activePartition.quotaPercent))}>{activePartition.quotaPercent.toFixed(2)}%</div>
                <div className="text-gray-500 text-[9px]">of {STORAGE_QUOTA_TB}TB</div>
              </div>
              <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                <div className="flex items-center gap-1 mb-1"><Files className="w-3 h-3 text-gray-600" /><label className="text-gray-600 text-[9px]">FILE COUNT</label></div>
                <div className="text-white font-bold text-sm">{activePartition.file_count > 0 ? activePartition.file_count.toLocaleString() : '—'}</div>
                {activePartition.file_count > 0 && <div className={cn("text-[9px]", getFileCountSeverity(activePartition.file_count).color)}>{getFileCountSeverity(activePartition.file_count).label}</div>}
              </div>
              <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                <div className="flex items-center gap-1 mb-1"><BarChart3 className="w-3 h-3 text-gray-600" /><label className="text-gray-600 text-[9px]">FILE QUOTA</label></div>
                <div className={cn("font-bold text-sm", getQuotaTextColor(activePartition.fileQuotaPercent))}>{activePartition.fileQuotaPercent.toFixed(3)}%</div>
                <div className="text-gray-500 text-[9px]">of {(FILE_COUNT_QUOTA / 1_000_000).toFixed(0)}M</div>
              </div>
            </div>

            {activePartition.parentQuotaPercent !== undefined && activePartition.parentQuotaPercent < 100 && (
              <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                <div className="flex items-center gap-1 mb-1"><BarChart3 className="w-3 h-3 text-gray-600" /><label className="text-gray-600 text-[9px]">% OF CURRENT DIR</label></div>
                <div className={cn("font-bold", getQuotaTextColor(activePartition.parentQuotaPercent))}>{activePartition.parentQuotaPercent.toFixed(1)}%</div>
              </div>
            )}

            {/* Show files for ANY node with originalFiles (not just synthetic nodes) */}
            {activePartition.originalFiles && activePartition.originalFiles.length > 0 && (
              <div className="bg-black/30 px-3 py-2 rounded border border-gray-800 max-h-48 overflow-y-auto">
                <div className="text-gray-500 text-[9px] uppercase mb-2">Files in this region:</div>
                <div className="space-y-1">
                  {activePartition.originalFiles.slice(0, 50).map((file, idx) => (
                    <div key={idx} onClick={() => onFileClick(file.path)} className={cn("flex items-center justify-between gap-2 p-1 rounded hover:bg-cyan-950/30 cursor-pointer transition-colors", selectedFileInPanel === file.path && "bg-cyan-950/50 border border-cyan-700")}>
                      <span className="text-white text-[10px] truncate flex-1">{file.name}</span>
                      <span className="text-gray-400 text-[9px] whitespace-nowrap">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                  {activePartition.originalFiles.length > 50 && <div className="text-gray-600 text-[9px] italic pt-1">+ {activePartition.originalFiles.length - 50} more files</div>}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 text-gray-600 py-2"><Focus className="w-5 h-5" /><span className="italic">Hover or right-click a partition to view details</span></div>
        )}
      </div>
    </div>
  )
}
