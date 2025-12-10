import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PreferencesState {
  theme: 'light' | 'dark' | 'system'
  defaultView: 'treemap' | 'tree' | 'list'
  itemsPerPage: number
  sidebarCollapsed: boolean
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setDefaultView: (view: 'treemap' | 'tree' | 'list') => void
  setItemsPerPage: (count: number) => void
  toggleSidebar: () => void
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'system',
      defaultView: 'treemap',
      itemsPerPage: 50,
      sidebarCollapsed: false,

      setTheme: (theme) => {
        set({ theme })
        if (typeof window !== 'undefined') {
          if (theme === 'dark') {
            document.documentElement.classList.add('dark')
          } else if (theme === 'light') {
            document.documentElement.classList.remove('dark')
          } else {
            const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
            document.documentElement.classList.toggle('dark', isDark)
          }
        }
      },

      setDefaultView: (view) => set({ defaultView: view }),

      setItemsPerPage: (count) => set({ itemsPerPage: count }),

      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    {
      name: 'storage-analytics-preferences',
    }
  )
)
