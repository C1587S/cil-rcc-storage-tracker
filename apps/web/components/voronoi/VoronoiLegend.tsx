import { TERMINAL_COLORS } from '@/lib/voronoi/utils/constants'

export function VoronoiLegend() {
  return (
    <div className="flex justify-between items-center text-[10px] uppercase tracking-wider font-mono text-gray-600 px-1">
      <div className="flex gap-4">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: TERMINAL_COLORS.folder, opacity: 0.4 }} />Directories</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded border border-dashed" style={{ borderColor: TERMINAL_COLORS.filesContainer, opacity: 0.7 }} />Files Region</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: TERMINAL_COLORS.file }} />Files</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded border" style={{ borderColor: '#ffffff', opacity: 0.5 }} />Preview</span>
      </div>
      <div className="text-gray-700">Hover partitions • Click to explore • Drag bubbles</div>
    </div>
  )
}
