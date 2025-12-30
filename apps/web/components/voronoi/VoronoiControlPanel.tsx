import { useAppStore } from '@/lib/store'
import { Palette } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

interface VoronoiControlPanelProps {
  cacheSize: number
  effectivePath: string
  historyLength: number
  navigationLock: boolean
}

const HIGHLIGHT_COLORS = [
  { name: 'Vanilla', value: '#f3e5ab' },
  { name: 'Electric Cyan', value: '#00ffff' },
  { name: 'Deep Crimson', value: '#990000' },
]

export function VoronoiControlPanel({
  cacheSize,
  effectivePath,
  historyLength,
  navigationLock
}: VoronoiControlPanelProps) {
  const theme = useAppStore(state => state.theme)
  const { highlightColor, setHighlightColor } = useAppStore()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const paletteRef = useRef<HTMLDivElement>(null)

  // Close palette when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(event.target as Node)) {
        setPaletteOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className={theme === 'dark' ? 'bg-[#0a0e14] border border-gray-800/50' : 'bg-card border border-border/30'} style={{ borderRadius: '0.5rem', padding: '0.75rem' }}>
      <div className="flex items-center justify-between gap-6 text-[10px]">
        {/* Controls + Color Selector */}
        <div className="flex items-center gap-4">
          <span className={theme === 'dark' ? 'text-gray-600 font-bold uppercase text-[9px]' : 'text-muted-foreground font-bold uppercase text-[9px]'}>Navigation:</span>
          <div className="flex gap-2">
            <span className={theme === 'dark' ? 'text-gray-500' : 'text-muted-foreground'}>Click partition to explore subfolder</span>
            <span className={theme === 'dark' ? 'text-gray-600' : 'text-muted-foreground/50'}>•</span>
            <span className={theme === 'dark' ? 'text-gray-500' : 'text-muted-foreground'}>Right-click to pin partition info</span>
            <span className={theme === 'dark' ? 'text-gray-600' : 'text-muted-foreground/50'}>•</span>
            <span className={theme === 'dark' ? 'text-gray-500' : 'text-muted-foreground'}>Pinned partitions with loose files show in info panel</span>
          </div>
          <span className={theme === 'dark' ? 'text-gray-600' : 'text-muted-foreground/50'}>|</span>
          <div className="relative" ref={paletteRef}>
            <button
              onClick={() => setPaletteOpen(!paletteOpen)}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-800/30 transition-colors"
              title="Change highlight color"
            >
              <Palette className="w-4 h-4" style={{ color: highlightColor }} />
            </button>
            {paletteOpen && (
              <div className={theme === 'dark' ? 'absolute top-full mt-1 right-0 flex gap-1 p-2 rounded border bg-[#0a0e14] border-gray-800/50 shadow-lg' : 'absolute top-full mt-1 right-0 flex gap-1 p-2 rounded border bg-card border-border/30 shadow-lg'}>
                {HIGHLIGHT_COLORS.map(color => (
                  <button
                    key={color.value}
                    onClick={() => {
                      setHighlightColor(color.value)
                      setPaletteOpen(false)
                    }}
                    className="w-6 h-6 rounded border-2 transition-all hover:scale-110"
                    style={{
                      backgroundColor: color.value,
                      borderColor: highlightColor === color.value ? (theme === 'dark' ? '#fff' : '#000') : 'transparent'
                    }}
                    title={color.name}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Status Info */}
        <div className="flex items-center gap-4 text-[9px]">
          <span className={theme === 'dark' ? 'text-gray-600' : 'text-muted-foreground'}>Cache: <span className={theme === 'dark' ? 'text-gray-500' : 'text-muted-foreground/80'}>{cacheSize}</span></span>
          <span className={theme === 'dark' ? 'text-gray-600' : 'text-muted-foreground'}>History: <span className={theme === 'dark' ? 'text-gray-500' : 'text-muted-foreground/80'}>{historyLength}</span></span>
          <span className={theme === 'dark' ? 'text-gray-600' : 'text-muted-foreground'}>View: <span className={theme === 'dark' ? 'text-gray-500 truncate max-w-[150px]' : 'text-muted-foreground/80 truncate max-w-[150px]'} title={effectivePath}>{effectivePath.split('/').pop()}</span></span>
          <span className={navigationLock ? 'text-yellow-600' : 'text-green-600'}>{navigationLock ? 'LOCKED' : 'Ready'}</span>
        </div>
      </div>
    </div>
  )
}
