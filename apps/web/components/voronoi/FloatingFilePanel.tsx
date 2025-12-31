import { useState, useRef, useEffect, useMemo } from 'react'
import { X, GripVertical, ArrowUpDown, Search, ChevronDown, Folder, Flag, Copy, Check, Minimize2, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/utils/formatters'
import { useAppStore } from '@/lib/store'

interface FileOrFolderInfo {
  name: string
  path: string
  size: number
  isDirectory: boolean
}

interface FloatingFilePanelProps {
  files: FileOrFolderInfo[]
  folders?: FileOrFolderInfo[]  // Optional subdirectories
  selectedFile: string | null
  onFileClick: (filePath: string) => void
  onClose: () => void
  isPinned?: boolean
  onTogglePin?: () => void
  copiedPath?: string | null
  onCopyPath?: (path: string) => void
  isFullscreen?: boolean  // Whether the visualization is in fullscreen mode
}

type SortColumn = 'name' | 'size'
type SortDirection = 'asc' | 'desc'

const INITIAL_DISPLAY_LIMIT = 100

export function FloatingFilePanel({ files, folders = [], selectedFile, onFileClick, onClose, isPinned = true, onTogglePin, copiedPath, onCopyPath, isFullscreen = false }: FloatingFilePanelProps) {
  const theme = useAppStore(state => state.theme)

  // Adjust position and size based on fullscreen mode
  const initialPosition = isFullscreen
    ? { x: window.innerWidth - 340, y: 80 }  // Fullscreen: align with partition panel start, stick to right with margin
    : { x: window.innerWidth - 370, y: 100 }  // Normal: right side of screen with small margin

  const initialSize = isFullscreen
    ? { width: 320, height: 200 }  // Fullscreen: match partition panel height (200px)
    : { width: 350, height: 500 }  // Normal: larger and taller

  const [position, setPosition] = useState(initialPosition)
  const [size, setSize] = useState(initialSize)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [sortColumn, setSortColumn] = useState<SortColumn>('size')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [searchQuery, setSearchQuery] = useState('')
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT)
  const [isMinimized, setIsMinimized] = useState(false)

  const panelRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<HTMLDivElement>(null)

  // Combine folders and files, filter, sort, and limit using useMemo for performance
  const { displayedItems, totalCount, maxSize } = useMemo(() => {
    // 1. Combine folders and files
    const allItems: FileOrFolderInfo[] = [...folders, ...files]

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
  }, [files, folders, searchQuery, sortColumn, sortDirection, displayLimit])

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection(column === 'size' ? 'desc' : 'asc')
    }
  }

  // Dragging handlers
  const handleMouseDownDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.resize-handle')) return
    setIsDragging(true)
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    })
  }

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsResizing(true)
    setDragStart({ x: e.clientX, y: e.clientY })
  }

  // Update position and size when fullscreen mode changes
  useEffect(() => {
    const newPosition = isFullscreen
      ? { x: window.innerWidth - 340, y: 80 }  // Fullscreen: align with partition panel
      : { x: window.innerWidth - 370, y: 100 }  // Normal: right side with margin

    const newSize = isFullscreen
      ? { width: 320, height: 200 }  // Fullscreen: match partition panel height
      : { width: 350, height: 500 }  // Normal: larger

    setPosition(newPosition)
    setSize(newSize)
  }, [isFullscreen])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: Math.max(0, Math.min(window.innerWidth - size.width, e.clientX - dragStart.x)),
          y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragStart.y))
        })
      } else if (isResizing) {
        const deltaX = e.clientX - dragStart.x
        const deltaY = e.clientY - dragStart.y
        setSize(prev => ({
          width: Math.max(250, Math.min(600, prev.width + deltaX)),
          height: Math.max(200, Math.min(800, prev.height + deltaY))
        }))
        setDragStart({ x: e.clientX, y: e.clientY })
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(false)
    }

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, isResizing, dragStart, size])

  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed z-50 rounded-lg shadow-2xl border flex flex-col overflow-hidden",
        theme === 'dark' ? 'bg-[#161b22] border-gray-700' : 'bg-white border-gray-300'
      )}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.width}px`,
        height: isMinimized ? 'auto' : `${size.height}px`,
        cursor: isDragging ? 'grabbing' : 'default'
      }}
    >
      {/* Header - draggable */}
      <div
        className={cn(
          "px-3 py-2 border-b flex items-center justify-between cursor-grab active:cursor-grabbing shrink-0",
          theme === 'dark' ? 'bg-gray-800/70 border-gray-700' : 'bg-gray-100 border-gray-300'
        )}
        onMouseDown={handleMouseDownDrag}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="w-4 h-4 text-gray-500" />
          <span className={cn(
            "font-semibold text-xs",
            theme === 'dark' ? 'text-gray-200' : 'text-gray-800'
          )}>
            Items ({totalCount} {searchQuery ? `of ${files.length + folders.length}` : ''})
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Minimize/Maximize button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsMinimized(!isMinimized)
            }}
            className={cn(
              "p-1 rounded hover:bg-gray-700/50 transition-colors",
              theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
            )}
            title={isMinimized ? "Expand panel" : "Minimize panel"}
          >
            {isMinimized ? (
              <Maximize2 className="w-4 h-4" />
            ) : (
              <Minimize2 className="w-4 h-4" />
            )}
          </button>
          {/* Pin/Flag button with improved tooltip */}
          {onTogglePin && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onTogglePin()
              }}
              className={cn(
                "p-1 rounded hover:bg-gray-700/50 transition-colors relative group",
                theme === 'dark' ? 'hover:text-white' : 'hover:text-gray-900'
              )}
            >
              <Flag className={cn(
                "w-4 h-4",
                isPinned
                  ? (theme === 'dark' ? 'text-red-500' : 'text-red-600')
                  : (theme === 'dark' ? 'text-gray-500' : 'text-gray-400')
              )} />
              {/* Tooltip */}
              <div className={cn(
                "absolute bottom-full right-0 mb-2 px-3 py-2 rounded-md text-xs whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-[200] shadow-lg border",
                theme === 'dark'
                  ? 'bg-gray-800 border-gray-700 text-gray-200'
                  : 'bg-white border-gray-300 text-gray-700'
              )}>
                <div className="text-[10px] leading-relaxed max-w-[200px] whitespace-normal">
                  {isPinned ? (
                    <>
                      <span className="font-semibold">Panel Fijado:</span> La posición del panel no cambiará al hacer hover sobre las particiones.
                    </>
                  ) : (
                    <>
                      <span className="font-semibold">Panel Libre:</span> El panel se cerrará automáticamente cuando dejes de hacer hover.
                    </>
                  )}
                </div>
                {/* Arrow */}
                <div className={cn(
                  "absolute top-full right-3 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent",
                  theme === 'dark' ? 'border-t-gray-800' : 'border-t-white'
                )} style={{ marginTop: '-1px' }} />
              </div>
            </button>
          )}
          {/* Close button */}
          <button
            onClick={onClose}
            className={cn(
              "p-1 rounded hover:bg-gray-700/50 transition-colors",
              theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
            )}
            title="Close panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content - only show when not minimized */}
      {!isMinimized && (
        <>
          {/* Search bar */}
          <div className={cn(
            "px-3 py-2 border-b shrink-0",
            theme === 'dark' ? 'bg-gray-800/20 border-gray-700' : 'bg-gray-50 border-gray-200'
          )}>
            <div className="relative">
          <Search className={cn(
            "absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5",
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          )} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files and folders..."
            className={cn(
              "w-full pl-8 pr-3 py-1.5 text-xs rounded border outline-none transition-colors",
              theme === 'dark'
                ? 'bg-gray-900/50 border-gray-700 text-white placeholder-gray-500 focus:border-cyan-600'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-cyan-500'
            )}
          />
        </div>
      </div>

      {/* Column headers with sort */}
      <div className={cn(
        "px-3 py-2 border-b flex items-center gap-2 shrink-0 text-xs",
        theme === 'dark' ? 'bg-gray-800/30 border-gray-700' : 'bg-gray-50 border-gray-200'
      )}>
        <button
          onClick={() => handleSort('name')}
          className={cn(
            "flex items-center gap-1 flex-1 hover:underline",
            theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
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
            "flex items-center gap-1 w-20 justify-end hover:underline",
            theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
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

      {/* File and folder list - scrollable */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {displayedItems.map((item, idx) => {
            const sizePercent = maxSize > 0 ? (item.size / maxSize) * 100 : 0
            return (
              <div
                key={idx}
                className={cn(
                  "flex flex-col gap-1 p-2 rounded transition-colors",
                  theme === 'dark'
                    ? "hover:bg-cyan-950/30"
                    : "hover:bg-cyan-100/50",
                  selectedFile === item.path && (
                    theme === 'dark'
                      ? "bg-cyan-950/50 border border-cyan-700"
                      : "bg-cyan-100 border border-cyan-400"
                  )
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer" onClick={() => onFileClick(item.path)}>
                    {item.isDirectory && (
                      <Folder className={cn(
                        "w-3.5 h-3.5 shrink-0",
                        theme === 'dark' ? 'text-green-400' : 'text-green-600'
                      )} />
                    )}
                    <span className={cn(
                      "truncate font-medium text-xs",
                      theme === 'dark' ? 'text-white' : 'text-gray-900'
                    )} title={item.name}>
                      {item.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Copy button */}
                    {onCopyPath && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onCopyPath(item.path)
                        }}
                        className={cn(
                          "p-0.5 rounded hover:bg-gray-700/50 transition-colors",
                          theme === 'dark' ? 'text-gray-500 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                        )}
                        title="Copy path to clipboard"
                      >
                        {copiedPath === item.path ? (
                          <Check className="w-3.5 h-3.5 text-green-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                    <span className={cn(
                      "whitespace-nowrap text-xs",
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    )}>
                      {formatBytes(item.size)}
                    </span>
                  </div>
                </div>
                {/* Bar aligned to the right */}
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
                "w-full py-2 px-3 mt-2 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1",
                theme === 'dark'
                  ? 'bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 border border-gray-700'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300'
              )}
            >
              <ChevronDown className="w-3.5 h-3.5" />
              Load More ({totalCount - displayedItems.length} remaining)
            </button>
          )}
        </div>
      </div>

          {/* Resize handle - bottom right corner */}
          <div
            ref={resizeRef}
            className={cn(
              "absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize resize-handle",
              theme === 'dark' ? 'bg-gray-700' : 'bg-gray-300'
            )}
            style={{
              clipPath: 'polygon(100% 0, 100% 100%, 0 100%)'
            }}
            onMouseDown={handleMouseDownResize}
          />
        </>
      )}
    </div>
  )
}
