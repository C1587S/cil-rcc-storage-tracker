'use client'

import { useState } from 'react'
import { vizApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { useNavigationStore } from '@/lib/stores/navigationStore'
import { formatBytes } from '@/lib/utils/formatters'
import { ChevronRight, ChevronDown, Folder, File } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface TreeNode {
  name: string
  path?: string
  size: number
  file_count?: number
  children?: TreeNode[]
}

function TreeNodeComponent({ node, depth = 0, onNavigate }: { node: TreeNode; depth?: number; onNavigate: (path: string) => void }) {
  const [isExpanded, setIsExpanded] = useState(depth < 2) // Auto-expand first 2 levels
  const hasChildren = node.children && node.children.length > 0
  const isFolder = hasChildren

  const percentage = depth === 0 ? 100 : 0 // We'll calculate this relative to parent

  return (
    <div className="select-none">
      {/* Node Row */}
      <div
        className={`
          flex items-center gap-2 py-1.5 px-2 hover:bg-accent rounded-sm cursor-pointer transition-colors
          ${depth === 0 ? 'border-b border-border pb-2 mb-2' : ''}
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (hasChildren) {
            setIsExpanded(!isExpanded)
          }
          if (isFolder && node.path) {
            onNavigate(node.path)
          }
        }}
      >
        {/* Expand/Collapse Icon */}
        {hasChildren && (
          <div className="flex-shrink-0 w-4">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        )}
        {!hasChildren && <div className="flex-shrink-0 w-4" />}

        {/* Icon */}
        {isFolder ? (
          <Folder className="h-4 w-4 text-blue-500 flex-shrink-0" />
        ) : (
          <File className="h-4 w-4 text-gray-500 flex-shrink-0" />
        )}

        {/* Name */}
        <span className={`flex-1 truncate ${depth === 0 ? 'font-bold text-base' : 'text-sm'}`} title={node.path || node.name}>
          {node.name}
        </span>

        {/* Size Bar */}
        <div className="flex-shrink-0 flex items-center gap-2" style={{ minWidth: '200px' }}>
          <div className="flex-1 h-5 bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full flex items-center px-2 ${
                depth === 0
                  ? 'bg-gradient-to-r from-blue-600 to-blue-400'
                  : depth === 1
                  ? 'bg-gradient-to-r from-blue-500 to-cyan-500'
                  : depth === 2
                  ? 'bg-gradient-to-r from-cyan-500 to-teal-500'
                  : 'bg-gradient-to-r from-teal-500 to-green-500'
              }`}
              style={{ width: `${Math.max(10, Math.min(100, percentage || 50))}%` }}
            >
              <span className="text-[10px] font-semibold text-white whitespace-nowrap">
                {formatBytes(node.size)}
              </span>
            </div>
          </div>

          {/* File Count */}
          {node.file_count && node.file_count > 1 && (
            <span className="text-[10px] text-muted-foreground w-16 text-right">
              {node.file_count.toLocaleString()} items
            </span>
          )}
        </div>
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div className="ml-2">
          {node.children!.map((child, idx) => (
            <TreeNodeComponent
              key={`${child.path || child.name}-${idx}`}
              node={child}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function TreemapView({ path, snapshot }: { path: string; snapshot: string }) {
  const { setCurrentPath } = useNavigationStore()
  const { data, isLoading } = useQuery({
    queryKey: ['treemap', path, snapshot],
    queryFn: () => vizApi.treemap(path, snapshot, 3), // Increased depth for better tree
    enabled: !!snapshot,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading storage tree...
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No data available
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 text-sm text-muted-foreground">
        Click folders to expand/collapse structure and navigate
      </div>
      <TreeNodeComponent node={data} onNavigate={setCurrentPath} />
    </div>
  )
}
