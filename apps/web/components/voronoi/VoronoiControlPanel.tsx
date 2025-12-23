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
    <div className="w-56 bg-[#161b22]/50 border border-gray-800 rounded-lg p-3 h-[420px] flex flex-col">
      <h4 className="text-white font-bold uppercase text-[9px] tracking-widest border-b border-gray-800 pb-2 mb-2 shrink-0">Controls</h4>
      <div className="space-y-1.5 text-[10px]">
        <div className="flex gap-2"><span className="text-green-500 font-bold w-14">L-CLICK:</span><span className="text-gray-400">Drill into</span></div>
        <div className="flex gap-2"><span className="text-cyan-400 font-bold w-14">R-CLICK:</span><span className="text-gray-400">Select partition</span></div>
        <div className="flex gap-2"><span className="text-gray-200 font-bold w-14">SCROLL:</span><span className="text-gray-400">Zoom</span></div>
        <div className="flex gap-2"><span className="text-yellow-400 font-bold w-14">DRAG:</span><span className="text-gray-400">Pan view</span></div>
        <div className="flex gap-2"><span className="text-purple-400 font-bold w-14">BUBBLES:</span><span className="text-gray-400">Drag files</span></div>
      </div>
      <div className="mt-auto pt-2 border-t border-gray-800 text-[9px] text-gray-600 space-y-1">
        <div>Cache: {cacheSize}</div>
        <div className="truncate" title={effectivePath}>View: {effectivePath.split('/').pop()}</div>
        <div>History: {historyLength}</div>
        <div className={navigationLock ? 'text-yellow-500' : 'text-green-500'}>{navigationLock ? '🔒 LOCKED' : '✓ Ready'}</div>
      </div>
    </div>
  )
}
