'use client'

import { useFolderData } from '@/lib/hooks/useFolderData'
import { useNavigationStore } from '@/lib/stores/navigationStore'
import { Button } from '@/components/ui/button'
import { Folder, ChevronRight } from 'lucide-react'
import { formatBytes } from '@/lib/utils/formatters'

export function FolderTree({ snapshot }: { snapshot: string }) {
  const { currentPath, setCurrentPath } = useNavigationStore()
  const { data, isLoading } = useFolderData(currentPath, snapshot, 1)

  if (isLoading) {
    return <div className="text-sm text-muted-foreground p-4">Loading...</div>
  }

  if (!data) return null

  // Filter to only show directories, sorted by size
  const folders = [...data.children]
    .filter(item => item.is_directory)
    .sort((a, b) => b.size - a.size)

  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-muted-foreground px-2 py-2 border-b">
        Folders
      </div>
      {folders.length === 0 ? (
        <div className="text-xs text-muted-foreground p-4 italic">
          No subfolders in this directory
        </div>
      ) : (
        <div className="space-y-0.5">
          {folders.map((folder) => (
            <Button
              key={folder.path}
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 h-auto py-2.5 px-2 hover:bg-accent"
              onClick={() => setCurrentPath(folder.path)}
            >
              <Folder className="h-4 w-4 text-blue-500 flex-shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col items-start">
                <span className="truncate text-left text-sm font-medium w-full" title={folder.path}>
                  {folder.name}
                </span>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="tabular-nums">{formatBytes(folder.size)}</span>
                  {folder.file_count > 0 && (
                    <>
                      <span>•</span>
                      <span>{folder.file_count.toLocaleString()} items</span>
                    </>
                  )}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
