import { useState, useMemo } from 'react'
import { Target, Folder, Files, FileText, HardDrive, BarChart3, Focus, Maximize2, ArrowUpDown, Search, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
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
  isPartitionFixed = false
}: VoronoiPartitionPanelProps) {
  const theme = useAppStore(state => state.theme)
  const [showFloatingPanel, setShowFloatingPanel] = useState(false)
  const [sortColumn, setSortColumn] = useState<SortColumn>('size')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [searchQuery, setSearchQuery] = useState('')
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT)

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

    // 1. Combine folders (only if partition is fixed with right-click) and files
    // When hovering: show only files
    // When fixed with right-click: show folders + files
    const allItems = [
      ...(isPartitionFixed && hasFolders ? (activePartition.children || []) : []),
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

  // DEBUG: Log active partition when it changes
  if (activePartition) {
    console.log('[VoronoiPartitionPanel] Active partition updated:', {
      name: activePartition.name,
      path: activePartition.path,
      file_count: activePartition.file_count,
      fileQuotaPercent: activePartition.fileQuotaPercent,
      size: activePartition.size,
      isDirectory: activePartition.isDirectory
    })
  }

  return (
    <div className={cn(
      "border rounded-lg overflow-hidden h-[200px] flex flex-col shrink-0",
      theme === 'dark' ? 'bg-[#161b22] border-gray-800' : 'bg-card border-border'
    )}>
      <div className={cn(
        "px-3 py-2 border-b flex items-center gap-2 shrink-0",
        theme === 'dark' ? 'bg-gray-800/50 border-gray-700' : 'bg-secondary/30 border-border'
      )}>
        <Target className={cn("w-4 h-4", theme === 'dark' ? 'text-cyan-400' : 'text-primary')} />
        <span className={cn("font-bold uppercase tracking-wider flex-1", theme === 'dark' ? 'text-white' : 'text-foreground')} style={{ fontSize: `${10 * textScale}px` }}>Partition Info</span>

        {/* Expand button - only show if there are files or folders */}
        {((activePartition?.originalFiles && activePartition.originalFiles.length > 0) || (activePartition?.children && activePartition.children.length > 0)) && (
          <button
            onClick={() => setShowFloatingPanel(true)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
              theme === 'dark'
                ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-200/50'
            )}
            title="Open floating file panel"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Files</span>
          </button>
        )}
      </div>

      <div className="p-3 overflow-y-auto flex-1">
        {activePartition ? (
          <div className="space-y-2">
            {/* Header with name and path inline */}
            <div className="flex items-center gap-2">
              {activePartition.isSynthetic ? <Files className="w-5 h-4 text-blue-400" /> : activePartition.isDirectory ? <Folder className="w-5 h-5 text-green-400" /> : <FileText className="w-5 h-5 text-gray-400" />}
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold truncate" style={{ fontSize: `${13 * textScale}px` }}>
                  {activePartition.name} <span className="text-gray-500 font-normal">({activePartition.path})</span>
                </p>
              </div>
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
                <label className="text-gray-600" style={{ fontSize: `${9 * textScale}px` }}>FILES:</label>
                <div className={cn("font-bold", getFileCountSeverity(activePartition.file_count).color)} style={{ fontSize: `${11 * textScale}px` }}>{activePartition.file_count > 0 ? activePartition.file_count.toLocaleString() : '—'}</div>
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

            {/* Show files and folders for ANY node (not just synthetic nodes) */}
            {((activePartition.originalFiles && activePartition.originalFiles.length > 0) || (activePartition.children && activePartition.children.length > 0)) && !showFloatingPanel && (
              <div className={cn(
                "px-3 py-2 rounded border max-h-64 overflow-y-auto",
                theme === 'dark' ? 'bg-black/30 border-gray-800' : 'bg-muted/20 border-border/30'
              )}>
                {/* Header with expand button */}
                    <div className="flex items-center justify-between mb-2">
                      <div className={cn(
                        "uppercase font-semibold",
                        theme === 'dark' ? 'text-gray-400' : 'text-gray-700'
                      )} style={{ fontSize: `${9 * textScale}px` }}>
                        {isPartitionFixed ? 'Items' : 'Files'} ({totalCount} {searchQuery ? `of ${(activePartition.originalFiles?.length || 0) + (isPartitionFixed ? (activePartition.children?.length || 0) : 0)}` : ''})
                      </div>
                      <button
                        onClick={() => setShowFloatingPanel(true)}
                        className={cn(
                          "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                          theme === 'dark'
                            ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                            : 'text-gray-600 hover:text-gray-800 hover:bg-gray-200/50'
                        )}
                      >
                        <Maximize2 className="w-3 h-3" />
                        <span>Expand</span>
                      </button>
                    </div>

                    {/* Search bar */}
                    <div className="mb-2">
                      <div className="relative">
                        <Search className={cn(
                          "absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3",
                          theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                        )} />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search files and folders..."
                          className={cn(
                            "w-full pl-7 pr-2 py-1 text-xs rounded border outline-none transition-colors",
                            theme === 'dark'
                              ? 'bg-gray-900/50 border-gray-700 text-white placeholder-gray-500 focus:border-cyan-600'
                              : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-cyan-500'
                          )}
                        />
                      </div>
                    </div>

                    {/* Column headers with sort */}
                    <div className={cn(
                      "flex items-center gap-2 mb-1 pb-1 border-b",
                      theme === 'dark' ? 'border-gray-700' : 'border-gray-300'
                    )}>
                      <button
                        onClick={() => handleSort('name')}
                        className={cn(
                          "flex items-center gap-1 flex-1 text-xs hover:underline",
                          theme === 'dark' ? 'text-gray-500' : 'text-gray-600'
                        )}
                      >
                        <span className="font-semibold">Name</span>
                        {sortColumn === 'name' && (
                          <ArrowUpDown className={cn(
                            "w-3 h-3",
                            sortDirection === 'asc' ? 'rotate-180' : ''
                          )} />
                        )}
                      </button>
                      <button
                        onClick={() => handleSort('size')}
                        className={cn(
                          "flex items-center gap-1 w-16 justify-end text-xs hover:underline",
                          theme === 'dark' ? 'text-gray-500' : 'text-gray-600'
                        )}
                      >
                        <span className="font-semibold">Size</span>
                        {sortColumn === 'size' && (
                          <ArrowUpDown className={cn(
                            "w-3 h-3",
                            sortDirection === 'asc' ? 'rotate-180' : ''
                          )} />
                        )}
                      </button>
                    </div>

                    {/* File and folder list */}
                    <div className="space-y-1">
                      {displayedItems.map((item, idx) => {
                        const sizePercent = maxSize > 0 ? (item.size / maxSize) * 100 : 0
                        return (
                          <div key={idx} onClick={() => onFileClick(item.path)} className={cn(
                            "flex flex-col gap-1 p-1 rounded cursor-pointer transition-colors",
                            theme === 'dark'
                              ? "hover:bg-cyan-950/30"
                              : "hover:bg-cyan-100/50",
                            selectedFileInPanel === item.path && (
                              theme === 'dark'
                                ? "bg-cyan-950/50 border border-cyan-700"
                                : "bg-cyan-100 border border-cyan-400"
                            )
                          )}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                {item.isDirectory && (
                                  <Folder className={cn(
                                    "w-3 h-3 shrink-0",
                                    theme === 'dark' ? 'text-green-400' : 'text-green-600'
                                  )} />
                                )}
                                <span className={cn(
                                  "truncate font-medium",
                                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                                )} style={{ fontSize: `${10 * textScale}px` }}>{item.name}</span>
                              </div>
                              <span className={cn(
                                "whitespace-nowrap",
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                              )} style={{ fontSize: `${9 * textScale}px` }}>{formatBytes(item.size)}</span>
                            </div>
                            {/* Bar aligned to the right, like Disk Usage Tree */}
                            <div className={cn(
                              "h-1 rounded-full overflow-hidden flex justify-end",
                              theme === 'dark' ? 'bg-gray-900/50' : 'bg-gray-300/50'
                            )}>
                              <div className={cn(
                                "h-full transition-all",
                                theme === 'dark' ? 'bg-cyan-500/60' : 'bg-cyan-500/70'
                              )} style={{ width: `${sizePercent}%` }} />
                            </div>
                          </div>
                        )
                      })}

                      {/* Load More button */}
                      {displayedItems.length < totalCount && (
                        <button
                          onClick={() => setDisplayLimit(prev => prev + 100)}
                          className={cn(
                            "w-full py-1.5 px-2 mt-2 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1",
                            theme === 'dark'
                              ? 'bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 border border-gray-700'
                              : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300'
                          )}
                        >
                          <ChevronDown className="w-3 h-3" />
                          Load More ({totalCount - displayedItems.length} remaining)
                        </button>
                      )}
                    </div>
                  </div>
            )}

            {/* Floating panel - renders outside the inline panel */}
            {((activePartition.originalFiles && activePartition.originalFiles.length > 0) || (activePartition.children && activePartition.children.length > 0)) && showFloatingPanel && (
              <FloatingFilePanel
                files={activePartition.originalFiles || []}
                folders={isPartitionFixed ? (activePartition.children || []) : []}
                selectedFile={selectedFileInPanel}
                onFileClick={onFileClick}
                onClose={() => setShowFloatingPanel(false)}
              />
            )}

          </div>
        ) : (
          <div className="flex items-center gap-3 text-gray-600 py-2"><Focus className="w-5 h-5" /><span className="italic" style={{ fontSize: `${12 * textScale}px` }}>Hover or right-click a partition to view details</span></div>
        )}
      </div>
    </div>
  )
}
