'use client'

import { FolderTree } from '@/components/navigation/FolderTree'
import { PathNavigator } from '@/components/navigation/PathNavigator'

interface SidebarProps {
  collapsed: boolean
  snapshot: string
}

export function Sidebar({ collapsed, snapshot }: SidebarProps) {
  if (collapsed) {
    return (
      <aside className="w-16 border-r bg-background fixed h-full">
        <div className="p-4 text-center text-xs text-muted-foreground">
          Collapsed
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-64 border-r bg-background fixed h-full overflow-y-auto">
      <div className="p-4 space-y-4">
        <PathNavigator />
        <FolderTree snapshot={snapshot} />
      </div>
    </aside>
  )
}
