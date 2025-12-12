'use client'

import { Menu, Terminal } from 'lucide-react'
import { SnapshotCalendarSelector } from '@/components/navigation/SnapshotCalendarSelector'
import { RootSelector } from '@/components/navigation/RootSelector'
import { Button } from '@/components/ui/button'
import { usePreferencesStore } from '@/lib/stores/preferencesStore'

export function Header({ snapshot }: { snapshot: string }) {
  const { toggleSidebar } = usePreferencesStore()

  return (
    <header className="h-16 border-b border-border bg-card flex items-center px-6 gap-4 shadow-sm">
      <Button variant="ghost" size="icon" onClick={toggleSidebar} className="hover:bg-secondary">
        <Menu className="h-5 w-5 text-[#ff9900]" />
      </Button>
      <div className="flex items-center gap-2">
        <Terminal className="h-5 w-5 text-[#ff9900]" />
        <h1 className="text-xl font-bold font-mono text-[#ff9900]">RCC-Storage-Tracker</h1>
      </div>
      <div className="flex items-center gap-4 ml-auto">
        <RootSelector snapshot={snapshot} />
        <SnapshotCalendarSelector currentSnapshot={snapshot} />
      </div>
    </header>
  )
}
