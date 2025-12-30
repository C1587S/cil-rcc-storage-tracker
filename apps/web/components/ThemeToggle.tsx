"use client"

import { useAppStore } from '@/lib/store'
import { Moon, Sun } from 'lucide-react'
import { useEffect } from 'react'

export function ThemeToggle() {
  const { theme, setTheme } = useAppStore()

  useEffect(() => {
    // Apply theme class to html element
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <button
      onClick={toggleTheme}
      className="group relative inline-flex items-center justify-center p-2 transition-all duration-300 hover:scale-110"
      style={{
        background: theme === 'dark'
          ? 'linear-gradient(135deg, #0a0e14 0%, #1a1f2e 100%)'
          : 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
        border: theme === 'dark'
          ? '1px solid rgba(250, 204, 21, 0.4)'
          : '1px solid rgba(250, 204, 21, 0.6)',
        boxShadow: theme === 'dark'
          ? '0 0 10px rgba(250, 204, 21, 0.3), inset 0 0 10px rgba(250, 204, 21, 0.08)'
          : '0 0 10px rgba(250, 204, 21, 0.4), inset 0 0 10px rgba(250, 204, 21, 0.1)',
        color: theme === 'dark' ? '#fcd34d' : '#ca8a04',
        borderRadius: '6px'
      }}
      title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    >
      {/* Animated border effect */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(250, 204, 21, 0.4), transparent)',
          animation: 'shimmer 2s infinite',
          borderRadius: 'inherit',
        }}
      />

      {/* Icon only - no text */}
      {theme === 'dark' ? (
        <Sun className="w-5 h-5 relative z-10" />
      ) : (
        <Moon className="w-5 h-5 relative z-10" />
      )}

      {/* Shimmer animation */}
      <style jsx>{`
        @keyframes shimmer {
          0%, 100% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </button>
  )
}
