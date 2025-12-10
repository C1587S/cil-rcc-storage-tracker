'use client'

import { useFolderData } from '@/lib/hooks/useFolderData'
import { useNavigationStore } from '@/lib/stores/navigationStore'
import { Button } from '@/components/ui/button'
import { Folder, File, ChevronRight } from 'lucide-react'
import { formatBytes, formatFileName } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils'

export function FolderTree({ snapshot }: { snapshot: string }) {
  const { currentPath, setCurrentPath } = useNavigationStore()
  const { data, isLoading } = useFolderData(currentPath, snapshot, 1)

  if (isLoading) {
    return <div className="text-sm text-muted-foreground p-4">Loading...</div>
  }

  if (!data) return null

  // Sort: directories first, then by size
  const sortedChildren = [...data.children].sort((a, b) => {
    if (a.is_directory && !b.is_directory) return -1
    if (!a.is_directory && b.is_directory) return 1
    return b.size - a.size
  })

  return (
    <div className="space-y-0.5">
      <div className="text-xs font-semibold text-muted-foreground px-2 py-1 border-b">
        Current Directory Contents
      </div>
      {sortedChildren.length === 0 ? (
        <div className="text-xs text-muted-foreground p-4 italic">
          No items in this directory
        </div>
      ) : (
        sortedChildren.map((item) => (
          <Button
            key={item.path}
            variant="ghost"
            size="sm"
            className={cn(
              'w-full justify-start gap-2 h-auto py-2 px-2 hover:bg-accent',
              item.is_directory && 'font-medium'
            )}
            onClick={() => item.is_directory && setCurrentPath(item.path)}
            disabled={!item.is_directory}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {item.is_directory ? (
                <Folder className="h-4 w-4 text-blue-500 flex-shrink-0" />
              ) : (
                <File className="h-4 w-4 text-gray-500 flex-shrink-0" />
              )}
              <span className="truncate text-left text-xs" title={item.path}>
                {item.name}
              </span>
              {item.is_directory && (
                <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0 ml-auto" />
              )}
            </div>
            <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {formatBytes(item.size)}
              </span>
              {item.is_directory && item.file_count > 0 && (
                <span className="text-[9px] text-muted-foreground">
                  {item.file_count.toLocaleString()} items
                </span>
              )}
            </div>
          </Button>
        ))
      )}
    </div>
  )
}
