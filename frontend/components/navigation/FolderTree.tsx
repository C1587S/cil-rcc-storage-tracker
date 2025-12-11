'use client'

import { useState } from 'react'
import { useFolderData } from '@/lib/hooks/useFolderData'
import { useNavigationStore } from '@/lib/stores/navigationStore'
import { ChevronRight, ChevronDown, Folder, FileText } from 'lucide-react'
import { formatBytes } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils'

interface TreeNodeProps {
  name: string
  path: string
  size: number
  fileCount: number
  isDirectory: boolean
  snapshot: string
  depth: number
  isCurrentPath: boolean
}

function TreeNode({ name, path, size, fileCount, isDirectory, snapshot, depth, isCurrentPath }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { setCurrentPath } = useNavigationStore()
  const { data } = useFolderData(path, snapshot, 1)

  const hasChildren = isDirectory && data && data.children.filter(c => c.is_directory).length > 0

  const handleClick = () => {
    if (isDirectory) {
      setCurrentPath(path)
      if (hasChildren) {
        setIsExpanded(!isExpanded)
      }
    }
  }

  const folders = data?.children.filter(item => item.is_directory).sort((a, b) => b.size - a.size) || []

  return (
    <div className="select-none">
      <div
        onClick={handleClick}
        className={cn(
          "group flex items-center gap-1.5 py-1 px-2 cursor-pointer rounded-md transition-all",
          "hover:bg-accent/50",
          isCurrentPath && "bg-accent font-medium"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {/* Expand/collapse chevron */}
        <div className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            )
          ) : null}
        </div>

        {/* Icon */}
        {isDirectory ? (
          <Folder className="w-3.5 h-3.5 text-blue-500/70 flex-shrink-0" />
        ) : (
          <FileText className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
        )}

        {/* Name and size */}
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="text-xs truncate" title={name}>
            {name}
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
            {formatBytes(size)}
          </span>
        </div>
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div className="space-y-0">
          {folders.map((folder) => (
            <TreeNode
              key={folder.path}
              name={folder.name}
              path={folder.path}
              size={folder.size}
              fileCount={folder.file_count}
              isDirectory={folder.is_directory}
              snapshot={snapshot}
              depth={depth + 1}
              isCurrentPath={false}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function FolderTree({ snapshot }: { snapshot: string }) {
  const { scanRoot, currentPath, setCurrentPath } = useNavigationStore()
  const { data, isLoading } = useFolderData(scanRoot, snapshot, 1)
  const [isRootExpanded, setIsRootExpanded] = useState(true)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-xs text-muted-foreground">
        <div className="animate-pulse">Loading tree...</div>
      </div>
    )
  }

  if (!data) return null

  // Get root name
  const rootName = scanRoot.split('/').filter(Boolean).pop() || 'Root'

  // Filter to only show directories, sorted by size
  const folders = [...data.children]
    .filter(item => item.is_directory)
    .sort((a, b) => b.size - a.size)

  const hasSubfolders = folders.length > 0

  return (
    <div className="py-2">
      {/* Root node - now clickable and expandable */}
      <div
        className={cn(
          "px-3 py-1.5 mb-1 border-b cursor-pointer hover:bg-accent rounded-sm transition-colors",
          currentPath === scanRoot && "bg-accent"
        )}
        onClick={() => setCurrentPath(scanRoot)}
      >
        <div className="flex items-center gap-1.5">
          {/* Expand/collapse chevron */}
          <div className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">
            {hasSubfolders && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsRootExpanded(!isRootExpanded)
                }}
                className="hover:bg-accent/50 rounded"
              >
                {isRootExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>
            )}
          </div>

          <Folder className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
          <span className="text-xs font-semibold">{rootName}</span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5 ml-5">
          {data.file_count.toLocaleString()} items · {formatBytes(data.total_size)}
        </div>
      </div>

      {/* Tree nodes - only show when expanded */}
      {isRootExpanded && (
        <div className="space-y-0 mt-1">
          {folders.length === 0 ? (
            <div className="text-[10px] text-muted-foreground p-4 italic text-center">
              No subfolders
            </div>
          ) : (
            folders.map((folder) => (
              <TreeNode
                key={folder.path}
                name={folder.name}
                path={folder.path}
                size={folder.size}
                fileCount={folder.file_count}
                isDirectory={folder.is_directory}
                snapshot={snapshot}
                depth={0}
                isCurrentPath={folder.path === currentPath}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
