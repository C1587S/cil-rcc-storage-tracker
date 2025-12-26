interface VoronoiControlPanelProps {
  cacheSize: number
  effectivePath: string
  historyLength: number
  navigationLock: boolean
}

export function VoronoiControlPanel({
  cacheSize,
  effectivePath,
  historyLength,
  navigationLock
}: VoronoiControlPanelProps) {
  return (
    <div className="bg-[#0a0e14] border border-gray-800/50 rounded-lg p-3">
      <div className="flex items-center justify-between gap-6 text-[10px]">
        {/* Controls */}
        <div className="flex items-center gap-4">
          <span className="text-gray-600 font-bold uppercase text-[9px]">Controls:</span>
          <div className="flex gap-3">
            <span className="text-gray-500">L-Click: Drill</span>
            <span className="text-gray-500">R-Click: Select</span>
            <span className="text-gray-500">Scroll: Zoom</span>
            <span className="text-gray-500">Drag: Pan</span>
            <span className="text-gray-500">Bubbles: Draggable</span>
          </div>
        </div>

        {/* Status Info */}
        <div className="flex items-center gap-4 text-[9px]">
          <span className="text-gray-600">Cache: <span className="text-gray-500">{cacheSize}</span></span>
          <span className="text-gray-600">History: <span className="text-gray-500">{historyLength}</span></span>
          <span className="text-gray-600">View: <span className="text-gray-500 truncate max-w-[150px]" title={effectivePath}>{effectivePath.split('/').pop()}</span></span>
          <span className={navigationLock ? 'text-yellow-600' : 'text-green-600'}>{navigationLock ? 'LOCKED' : 'Ready'}</span>
        </div>
      </div>
    </div>
  )
}
