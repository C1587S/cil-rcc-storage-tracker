"use client"

import { useAppStore } from '@/lib/store'
import { Moon, Sun } from 'lucide-react'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'

export function ThemeToggle() {
  const { theme, setTheme } = useAppStore()

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
  }, [theme])

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className={cn(
        "inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors duration-150",
        "border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
      title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}
