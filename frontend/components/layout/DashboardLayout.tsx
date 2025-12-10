'use client'

import { ReactNode } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
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
          {children}
        </main>
      </div>
    </div>
  )
}
