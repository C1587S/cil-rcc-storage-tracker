'use client'

import { useState } from 'react'
import { foldersApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { formatBytes } from '@/lib/utils/formatters'
import type { FolderTreeNode } from '@/lib/types'

interface TreeNodeProps {
  node: FolderTreeNode
  snapshot: string
  maxSize: number
  depth?: number
  parentExpanded?: boolean
  isLast?: boolean
  prefix?: string
}

// Terminal-like box drawing characters
const TREE_CHARS = {
  branch: '├── ',
  last: '└── ',
  vertical: '│   ',
  space: '    ',
}

// Color palette inspired by rich library
const COLORS = {
  directory: 'text-blue-400',
  file: 'text-gray-400',
  size: 'text-yellow-400',
  percent: 'text-cyan-400',
  bar: 'text-green-400',
  barHeavy: 'text-red-400',
  barMedium: 'text-yellow-400',
  barLight: 'text-green-400',
}

function TreeNode({
  node,
  snapshot,
  maxSize,
  depth = 0,
  parentExpanded = true,
  isLast = false,
  prefix = ''
}: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasChildren = node.is_directory && (node.children?.length ?? 0) > 0

  // Calculate percentage relative to the root size (maxSize)
  // This ensures percentages never exceed 100% and are consistent across all levels
  const percentage = Math.min((node.size / maxSize) * 100, 100)

  // Debug: Log if percentage exceeds 100 before clamping
  if ((node.size / maxSize) * 100 > 100) {
    console.warn(`[DiskUsageTree] Node "${node.name}" has size ${node.size} which exceeds maxSize ${maxSize} (${((node.size / maxSize) * 100).toFixed(1)}%)`)
  }

  // Only show if parent is expanded or if we're at root level
  if (!parentExpanded && depth > 0) return null

  // Calculate bar width (max 30 characters for the bar)
  const barWidth = Math.max(1, Math.floor((percentage / 100) * 30))
  const barChar = percentage > 70 ? '█' : percentage > 30 ? '▓' : '░'
  const bar = barChar.repeat(barWidth)

  // Choose bar color based on percentage
  const barColor = percentage > 70 ? COLORS.barHeavy : percentage > 30 ? COLORS.barMedium : COLORS.barLight

  // Tree structure prefix
  const connector = isLast ? TREE_CHARS.last : TREE_CHARS.branch
  const linePrefix = prefix + connector

  return (
    <div className="font-mono text-xs leading-relaxed">
      <div
        className="flex items-center hover:bg-accent/5 group transition-colors cursor-pointer"
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        {/* Tree structure and name */}
        <div className="flex items-center min-w-0 flex-shrink-0" style={{ width: '400px' }}>
          <span className="text-muted-foreground/50 select-none">{linePrefix}</span>

          {hasChildren && (
            <span className="mr-1 text-muted-foreground">
              {isExpanded ? '▼' : '▶'}
            </span>
          )}

          <span className={node.is_directory ? COLORS.directory : COLORS.file}>
            {node.is_directory ? '📁 ' : '📄 '}
            {node.name}
          </span>

          {node.is_directory && node.file_count > 0 && (
            <span className="text-muted-foreground/50 ml-1 text-[10px]">
              ({node.file_count.toLocaleString()})
            </span>
          )}
        </div>

        {/* Bar visualization */}
        <div className="flex items-center gap-3 ml-4">
          <span className={`${barColor} min-w-[240px]`}>
            {bar}
          </span>

          <span className={`${COLORS.size} w-20 text-right tabular-nums`}>
            {formatBytes(node.size)}
          </span>

          <span className={`${COLORS.percent} w-12 text-right tabular-nums`}>
            {percentage.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div>
          {node.children!
            .sort((a, b) => b.size - a.size)
            .map((child, index) => {
              const isLastChild = index === node.children!.length - 1
              const childPrefix = prefix + (isLast ? TREE_CHARS.space : TREE_CHARS.vertical)

              return (
                <TreeNode
                  key={child.path}
                  node={child}
                  snapshot={snapshot}
                  maxSize={maxSize}
                  depth={depth + 1}
                  parentExpanded={isExpanded}
                  isLast={isLastChild}
                  prefix={childPrefix}
                />
              )
            })}
        </div>
      )}
    </div>
  )
}

export function DiskUsageTree({ path, snapshot }: { path: string; snapshot: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['folder-tree', path, snapshot],
    queryFn: () => foldersApi.getTree(path, snapshot),
    enabled: !!snapshot && !!path,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground font-mono text-sm">
        <div className="animate-pulse">Loading tree structure...</div>
      </div>
    )
  }

  if (error) {
    console.error('DiskUsageTree error:', error)
    return (
      <div className="flex flex-col items-center justify-center h-32 text-destructive font-mono text-sm">
        <div className="font-semibold">Error loading tree</div>
        <div className="text-xs mt-1">{(error as any)?.message || 'Unknown error'}</div>
        <div className="text-xs text-muted-foreground">Path: {path}</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground font-mono text-sm">
        <div className="text-center">
          <div>No data available</div>
          <div className="text-xs mt-1">Path: {path}</div>
        </div>
      </div>
    )
  }

  console.log('DiskUsageTree data:', data)

  // Show immediate children - both directories AND files (sorted by size)
  const immediateChildren = data.children?.sort((a, b) => b.size - a.size) || []

  if (immediateChildren.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground font-mono text-sm">
        <div className="text-center">
          <div>No children found</div>
          <div className="text-xs mt-1">{data.name || path}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1 p-4 bg-slate-950 rounded-lg border border-slate-800">
      {/* Terminal-like header */}
      <div className="font-mono text-xs text-muted-foreground mb-4 pb-2 border-b border-slate-800 flex items-center justify-between">
        <span className="text-cyan-400">
          Current: <span className="text-blue-400">{data.name}</span>
        </span>
        <span className="text-yellow-400">
          Total: {formatBytes(data.size)}
        </span>
      </div>

      {/* Tree visualization */}
      <div className="space-y-0">
        {immediateChildren.map((child, index) => (
          <TreeNode
            key={child.path}
            node={child}
            snapshot={snapshot}
            maxSize={data.size}
            depth={0}
            isLast={index === immediateChildren.length - 1}
          />
        ))}
      </div>

      {/* Terminal-like footer */}
      <div className="font-mono text-[10px] text-muted-foreground mt-4 pt-2 border-t border-slate-800">
        Click items to expand. Bars show relative size. Sorted by size (largest first).
      </div>
    </div>
  )
}
