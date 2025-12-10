'use client'

import { useFolderData } from '@/lib/hooks/useFolderData'
import { useNavigationStore } from '@/lib/stores/navigationStore'
import { Button } from '@/components/ui/button'
import { Folder, File } from 'lucide-react'
import { formatBytes } from '@/lib/utils/formatters'

export function FolderTree({ snapshot }: { snapshot: string }) {
  const { currentPath, setCurrentPath } = useNavigationStore()
  const { data, isLoading } = useFolderData(currentPath, snapshot, 1)

  if (isLoading) return <div>Loading...</div>
  if (!data) return null

  return (
    <div className="space-y-1">
      {data.children.map((item) => (
        <Button
          key={item.path}
          variant="ghost"
          className="w-full justify-start gap-2"
          onClick={() => item.is_directory && setCurrentPath(item.path)}
        >
          {item.is_directory ? <Folder className="h-4 w-4" /> : <File className="h-4 w-4" />}
          <span className="flex-1 truncate text-left">{item.name}</span>
          <span className="text-xs text-muted-foreground">{formatBytes(item.size)}</span>
        </Button>
      ))}
    </div>
  )
}
