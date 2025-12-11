'use client'

import { Menu, Terminal } from 'lucide-react'
import { SnapshotCalendarSelector } from '@/components/navigation/SnapshotCalendarSelector'
import { Button } from '@/components/ui/button'
import { usePreferencesStore } from '@/lib/stores/preferencesStore'

export function Header({ snapshot }: { snapshot: string }) {
  const { toggleSidebar } = usePreferencesStore()

  return (
    <header className="h-16 border-b border-border bg-card flex items-center px-6 gap-4 shadow-sm">
      <Button variant="ghost" size="icon" onClick={toggleSidebar} className="hover:bg-secondary">
        <Menu className="h-5 w-5" />
      </Button>
      <div className="flex items-center gap-2">
        <Terminal className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold font-mono text-primary">RCC-Store-Tracker</h1>
      </div>
      <div className="ml-auto">
        <SnapshotCalendarSelector currentSnapshot={snapshot} />
      </div>
    </header>
  )
}
