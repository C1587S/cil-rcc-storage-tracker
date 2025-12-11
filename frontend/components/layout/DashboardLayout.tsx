'use client'

import { ReactNode } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { SnapshotCalendar } from '@/components/visualizations/SnapshotCalendar'
import { usePreferencesStore } from '@/lib/stores/preferencesStore'

interface DashboardLayoutProps {
  children: ReactNode
  snapshot: string
}

export function DashboardLayout({ children, snapshot }: DashboardLayoutProps) {
  const { sidebarCollapsed } = usePreferencesStore()

  return (
    <div className="h-screen flex flex-col">
      <Header snapshot={snapshot} />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar collapsed={sidebarCollapsed} snapshot={snapshot} />
        <main className={`flex-1 overflow-y-auto transition-all ${
          sidebarCollapsed ? 'ml-16' : 'ml-64'
        }`}>
          {/* Calendar timeline - scrolls away with page content */}
          <div className="border-b bg-background px-6 py-2">
            <SnapshotCalendar />
          </div>

          {children}
        </main>
      </div>
    </div>
  )
}
