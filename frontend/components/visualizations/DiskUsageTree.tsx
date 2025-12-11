'use client'

import { useState } from 'react'
import { foldersApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { formatBytes, getFileExtension } from '@/lib/utils/formatters'
import { ChevronRight, ChevronDown, Folder, File } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FolderTreeNode } from '@/lib/types'

interface TreeNodeProps {
  node: FolderTreeNode
  snapshot: string
  maxSize: number
  depth?: number
  parentExpanded?: boolean
}

const getFileTypeColor = (name: string, isDirectory: boolean): string => {
  if (isDirectory) return '#3b82f6'

  const ext = getFileExtension(name).toLowerCase()
  const colorMap: Record<string, string> = {
    'py': '#3776ab',
    'js': '#f7df1e',
    'ts': '#3178c6',
    'json': '#292929',
    'csv': '#16a34a',
    'log': '#6b7280',
    'txt': '#9ca3af',
    'pdf': '#dc2626',
    'zip': '#7c3aed',
    'tar': '#7c3aed',
    'gz': '#6d28d9',
  }
  return colorMap[ext] || '#10b981'
}

function TreeNode({ node, snapshot, maxSize, depth = 0, parentExpanded = true }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasChildren = node.is_directory && (node.children?.length ?? 0) > 0
  const percentage = (node.size / maxSize) * 100
  const barColor = getFileTypeColor(node.name, node.is_directory)

  // Only show if parent is expanded or if we're at root level
  if (!parentExpanded && depth > 0) return null

  return (
    <div className="font-mono text-xs">
      <div className="flex items-center gap-2 hover:bg-accent py-1 px-2 rounded group transition-colors">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {hasChildren ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 hover:bg-accent/50"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </Button>
          ) : (
            <span className="w-5" />
          )}

          {node.is_directory ? (
            <Folder className="h-3.5 w-3.5 flex-shrink-0" style={{ color: barColor }} />
          ) : (
            <File className="h-3.5 w-3.5 flex-shrink-0" style={{ color: barColor }} />
          )}

          <span className="truncate font-medium text-foreground">{node.name}</span>
          {node.is_directory && node.file_count > 0 && (
            <span className="text-[9px] text-muted-foreground ml-1">
              ({node.file_count.toLocaleString()})
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="w-56 bg-secondary rounded-full h-5 overflow-hidden">
            <div
              className="h-full flex items-center px-2 transition-all duration-300"
              style={{
                width: `${Math.max(percentage, 2)}%`,
                backgroundColor: barColor,
              }}
            >
              {percentage > 8 && (
                <span className="text-[10px] text-white font-semibold whitespace-nowrap">
                  {formatBytes(node.size)}
                </span>
              )}
            </div>
          </div>

          <span className="text-[10px] text-muted-foreground w-12 text-right tabular-nums">
            {percentage.toFixed(1)}%
          </span>

          {percentage <= 8 && (
            <span className="text-[10px] text-muted-foreground w-16 text-right tabular-nums">
              {formatBytes(node.size)}
            </span>
          )}
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div className="ml-4 border-l-2 border-border/50 pl-2 mt-0.5">
          {node.children!
            .sort((a, b) => b.size - a.size)
            .map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                snapshot={snapshot}
                maxSize={maxSize}
                depth={depth + 1}
                parentExpanded={isExpanded}
              />
            ))}
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
      <div className="flex items-center justify-center h-32 text-muted-foreground">
        Loading tree structure...
      </div>
    )
  }

  if (error) {
    console.error('DiskUsageTree error:', error)
    return (
      <div className="flex flex-col items-center justify-center h-32 text-destructive">
        <div className="font-semibold">Error loading tree</div>
        <div className="text-xs mt-1">{(error as any)?.message || 'Unknown error'}</div>
        <div className="text-xs text-muted-foreground">Path: {path}</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground">
        <div className="text-center">
          <div>No data available</div>
          <div className="text-xs mt-1">Path: {path}</div>
        </div>
      </div>
    )
  }

  console.log('DiskUsageTree data:', data)

  // Show only immediate children at first (similar to dutree default behavior)
  const immediateChildren = data.children?.sort((a, b) => b.size - a.size) || []

  if (immediateChildren.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground">
        <div className="text-center">
          <div>No children found</div>
          <div className="text-xs mt-1">{data.name || path}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1 p-2">
      <div className="text-xs text-muted-foreground mb-3 px-2 flex items-center justify-between">
        <span>Click chevrons to expand folders. Colors indicate file types. Sorted by size.</span>
        <span className="font-mono text-[10px]">Current: {data.name}</span>
      </div>
      <div className="space-y-0.5">
        {immediateChildren.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            snapshot={snapshot}
            maxSize={data.size}
            depth={0}
          />
        ))}
      </div>
    </div>
  )
}
