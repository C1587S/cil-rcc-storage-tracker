import { useState, useMemo } from 'react'
import { Target, Folder, Files, FileText, HardDrive, BarChart3, Focus, Maximize2, ArrowUpDown, Search, ChevronDown, Flag, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GridLoader } from '@/components/ui/grid-loader'
import { formatBytes } from '@/lib/utils/formatters'
import { getSizeSeverity, getFileCountSeverity, getQuotaTextColor } from '@/lib/voronoi/utils/colors'
import { type PartitionInfo } from '@/lib/voronoi/utils/types'
import { useAppStore } from '@/lib/store'
import { FloatingFilePanel } from './FloatingFilePanel'

interface VoronoiPartitionPanelProps {
  activePartition: PartitionInfo | null
  selectedFileInPanel: string | null
  onFileClick: (filePath: string) => void
  isExpanded?: boolean
  isFullscreen?: boolean
  isPartitionFixed?: boolean  // True when partition is selected with right-click (not just hovered)
  heightClassName?: string    // Override panel height (default sm:h-[200px])
}

type SortColumn = 'name' | 'size'
type SortDirection = 'asc' | 'desc'

const INITIAL_DISPLAY_LIMIT = 100

export function VoronoiPartitionPanel({
  activePartition,
  selectedFileInPanel,
  onFileClick,
  isExpanded = false,
  isFullscreen = false,
  isPartitionFixed = false,
  heightClassName = 'sm:h-auto'
}: VoronoiPartitionPanelProps) {
  const theme = useAppStore(state => state.theme)
  const [showFloatingPanel, setShowFloatingPanel] = useState(false)
  const [isPanelPinned, setIsPanelPinned] = useState(false)
  const [sortColumn, setSortColumn] = useState<SortColumn>('size')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [searchQuery, setSearchQuery] = useState('')
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')

  // Copy to clipboard function
  const copyToClipboard = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
      setCopiedPath(path)
      setToastMessage(`Path copied: ${path}`)
      setShowToast(true)
      setTimeout(() => {
        setCopiedPath(null)
        setShowToast(false)
      }, 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Fixed height, no scaling
  const textScale = 1

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection(column === 'size' ? 'desc' : 'asc')
    }
  }

  // Combine folders and files, filter, sort, and limit using useMemo for performance
  const { displayedItems, totalCount, maxSize } = useMemo(() => {
    const hasFiles = activePartition?.originalFiles && activePartition.originalFiles.length > 0
    const hasFolders = activePartition?.children && activePartition.children.length > 0

    if (!hasFiles && !hasFolders) {
      return { displayedItems: [], totalCount: 0, maxSize: 0 }
    }

    // Folders and files are both listed/searchable in hover and fixed modes
    const allItems = [
      ...(hasFolders ? (activePartition.children || []) : []),
      ...(activePartition.originalFiles || [])
    ]

    // 2. Filter by search query
    const filtered = searchQuery.trim()
      ? allItems.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : allItems

    // 3. Sort
    const sorted = [...filtered].sort((a, b) => {
      const multiplier = sortDirection === 'asc' ? 1 : -1
      if (sortColumn === 'name') {
        return multiplier * a.name.localeCompare(b.name)
      } else {
        return multiplier * (a.size - b.size)
      }
    })

    // 4. Limit display
    const displayed = sorted.slice(0, displayLimit)

    // 5. Calculate max size for bars
    const maxItemSize = allItems.length > 0 ? Math.max(...allItems.map(item => item.size)) : 0

    return {
      displayedItems: displayed,
      totalCount: sorted.length,
      maxSize: maxItemSize
    }
  }, [activePartition?.originalFiles, activePartition?.children, isPartitionFixed, searchQuery, sortColumn, sortDirection, displayLimit])

  return (
    <div className={cn(
      "border rounded-lg overflow-hidden h-auto flex flex-col shrink-0",
      heightClassName,
      theme === 'dark' ? 'bg-[#161b22] border-gray-800' : 'bg-card border-border'
    )}>
      <div className={cn(
        "px-3 py-2 border-b flex items-center gap-2 shrink-0",
        theme === 'dark' ? 'bg-gray-800/50 border-gray-700' : 'bg-secondary/30 border-border'
      )}>
        <Target className={cn("w-4 h-4", theme === 'dark' ? 'text-cyan-400' : 'text-primary')} />
        <span className={cn("font-bold uppercase tracking-wider flex-1", theme === 'dark' ? 'text-white' : 'text-foreground')} style={{ fontSize: `${10 * textScale}px` }}>Directory Info</span>

        {/* Expand button - only show if there are files or folders */}
        {((activePartition?.originalFiles && activePartition.originalFiles.length > 0) || (activePartition?.children && activePartition.children.length > 0)) && (
          <button
            onClick={() => setShowFloatingPanel(true)}
            className={cn(
              "w-5 h-5 flex items-center justify-center rounded-full border text-[10px] font-bold transition-colors",
              theme === 'dark'
                ? 'border-gray-600 text-gray-400 hover:text-white hover:border-gray-400'
                : 'border-gray-400 text-gray-600 hover:text-gray-900 hover:border-gray-600'
            )}
            title="Expand full file listing"
          >
            i
          </button>
        )}
      </div>

      <div className="p-3 flex-1">
        {activePartition ? (
          <div className="space-y-2">
            {/* Header with name and path inline */}
            <div className="flex items-center gap-2">
              {activePartition.isSynthetic ? <Files className="w-5 h-4 text-blue-400" /> : activePartition.isDirectory ? <Folder className="w-5 h-5 text-green-400" /> : <FileText className="w-5 h-5 text-gray-400" />}
              <div className="flex-1 min-w-0">
                <p className={cn("font-bold truncate", theme === 'dark' ? 'text-white' : 'text-gray-900')} style={{ fontSize: `${13 * textScale}px` }}>
                  {activePartition.name} <span className="text-gray-500 font-normal">({activePartition.path})</span>
                </p>
              </div>
              {/* Copy path button */}
              <button
                onClick={() => copyToClipboard(activePartition.path)}
                className={cn(
                  "p-1 rounded hover:bg-gray-700/50 transition-colors shrink-0",
                  theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                )}
                title="Copy path to clipboard"
              >
                {copiedPath === activePartition.path ? (
                  <Check className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            {/* Metrics in single horizontal row */}
            <div className={cn(
              "px-3 py-2 rounded border flex items-center gap-3 flex-wrap",
              theme === 'dark' ? 'bg-black/30 border-gray-800' : 'bg-muted/20 border-border/30'
            )}>
              {/* SIZE */}
              <div className="flex items-center gap-1.5">
                <HardDrive className="w-3 h-3 text-gray-600" />
                <label className="text-gray-600" style={{ fontSize: `${9 * textScale}px` }}>SIZE:</label>
                <div className={cn("font-bold", getSizeSeverity(activePartition.size).color)} style={{ fontSize: `${11 * textScale}px` }}>{formatBytes(activePartition.size)}</div>
              </div>

              <div className={cn("h-4 w-px", theme === 'dark' ? 'bg-gray-700' : 'bg-border')} />

              {/* STORAGE QUOTA */}
              <div className="flex items-center gap-1.5">
                <BarChart3 className="w-3 h-3 text-gray-600" />
                <label className="text-gray-600" style={{ fontSize: `${9 * textScale}px` }}>QUOTA:</label>
                <div className={cn("font-bold", getQuotaTextColor(activePartition.quotaPercent))} style={{ fontSize: `${11 * textScale}px` }}>{activePartition.quotaPercent.toFixed(2)}%</div>
              </div>

              <div className={cn("h-4 w-px", theme === 'dark' ? 'bg-gray-700' : 'bg-border')} />

              {/* FILE COUNT */}
              <div className="flex items-center gap-1.5">
                <Files className="w-3 h-3 text-gray-600" />
                <label className="text-gray-600" style={{ fontSize: `${9 * textScale}px` }}>FILES (TOTAL):</label>
                <div className={cn("font-bold", getFileCountSeverity(activePartition.file_count).color)} style={{ fontSize: `${11 * textScale}px` }}>{activePartition.file_count > 0 ? activePartition.file_count.toLocaleString() : '—'}</div>
              </div>
              <div>
                <label className="text-gray-600" style={{ fontSize: `${9 * textScale}px` }}>FILES (DIRECT):</label>
                <div className="font-bold" style={{ fontSize: `${11 * textScale}px` }}>{(activePartition.originalFiles?.length ?? 0).toLocaleString()}</div>
              </div>
              <div>
                <label className="text-gray-600" style={{ fontSize: `${9 * textScale}px` }}>SUBDIRS (DIRECT):</label>
                <div className="font-bold" style={{ fontSize: `${11 * textScale}px` }}>{(activePartition.children?.length ?? 0).toLocaleString()}</div>
              </div>

              <div className={cn("h-4 w-px", theme === 'dark' ? 'bg-gray-700' : 'bg-border')} />

              {/* FILE QUOTA */}
              <div className="flex items-center gap-1.5">
                <BarChart3 className="w-3 h-3 text-gray-600" />
                <label className="text-gray-600" style={{ fontSize: `${9 * textScale}px` }}>FILE %:</label>
                <div className={cn("font-bold", getQuotaTextColor(activePartition.fileQuotaPercent))} style={{ fontSize: `${11 * textScale}px` }}>{activePartition.fileQuotaPercent.toFixed(3)}%</div>
              </div>

              {/* PARENT QUOTA (optional) */}
              {activePartition.parentQuotaPercent !== undefined && activePartition.parentQuotaPercent < 100 && (
                <>
                  <div className={cn("h-4 w-px", theme === 'dark' ? 'bg-gray-700' : 'bg-border')} />
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="w-3 h-3 text-gray-600" />
                    <label className="text-gray-600" style={{ fontSize: `${9 * textScale}px` }}>OF DIR:</label>
                    <div className={cn("font-bold", getQuotaTextColor(activePartition.parentQuotaPercent))} style={{ fontSize: `${11 * textScale}px` }}>{activePartition.parentQuotaPercent.toFixed(1)}%</div>
                  </div>
                </>
              )}
            </div>

            {/* Compact files row: the listing lives in the expandable floating
                panel (info button / this row); the card itself stays fixed-height */}
            {((activePartition.originalFiles && activePartition.originalFiles.length > 0) || (activePartition.children && activePartition.children.length > 0)) && !showFloatingPanel && (
              <button
                onClick={() => setShowFloatingPanel(true)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-1.5 rounded border text-xs transition-colors",
                  theme === 'dark'
                    ? 'bg-black/30 border-gray-800 text-gray-400 hover:text-white hover:border-gray-600'
                    : 'bg-muted/20 border-border/30 text-gray-600 hover:text-gray-900 hover:border-border'
                )}
              >
                <span className="uppercase font-semibold" style={{ fontSize: `${9 * textScale}px` }}>
                  Files & folders ({totalCount})
                </span>
                <span className="flex items-center gap-1">
                  <Maximize2 className="w-3 h-3" />
                  <span>Expand</span>
                </span>
              </button>
            )}

            {/* Floating panel - renders outside the inline panel */}
            {((activePartition.originalFiles && activePartition.originalFiles.length > 0) || (activePartition.children && activePartition.children.length > 0)) && showFloatingPanel && (
              <FloatingFilePanel
                files={activePartition.originalFiles || []}
                folders={isPartitionFixed ? (activePartition.children || []) : []}
                selectedFile={selectedFileInPanel}
                onFileClick={onFileClick}
                onClose={() => setShowFloatingPanel(false)}
                isPinned={isPanelPinned}
                onTogglePin={() => setIsPanelPinned(!isPanelPinned)}
                copiedPath={copiedPath}
                onCopyPath={copyToClipboard}
                isFullscreen={isFullscreen}
              />
            )}

          </div>
        ) : (
          <div className="flex items-center gap-3 text-muted-foreground py-4 justify-center">
            <span style={{ fontSize: `${11 * textScale}px` }}>Hover or right-click a partition to inspect</span>
          </div>
        )}
      </div>

      {/* Toast notification */}
      {showToast && (
        <div className="fixed bottom-4 right-4 z-[100] animate-in slide-in-from-bottom-2 fade-in duration-200">
          <div className={cn(
            "px-4 py-2 rounded-lg shadow-lg border flex items-center gap-2 max-w-md",
            theme === 'dark'
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          )}>
            <Check className="w-4 h-4 text-green-500 shrink-0" />
            <span className="text-sm truncate">{toastMessage}</span>
          </div>
        </div>
      )}
    </div>
  )
}
