'use client'

import { Menu } from 'lucide-react'
import { SnapshotCalendarSelector } from '@/components/navigation/SnapshotCalendarSelector'
import { Button } from '@/components/ui/button'
import { usePreferencesStore } from '@/lib/stores/preferencesStore'

export function Header({ snapshot }: { snapshot: string }) {
  const { toggleSidebar } = usePreferencesStore()

  return (
    <header className="h-16 border-b bg-background flex items-center px-6 gap-4">
      <Button variant="ghost" size="icon" onClick={toggleSidebar}>
        <Menu className="h-5 w-5" />
      </Button>
      <h1 className="text-xl font-bold">Storage Analytics</h1>
      <div className="ml-auto">
        <SnapshotCalendarSelector currentSnapshot={snapshot} />
      </div>
    </header>
  )
}
