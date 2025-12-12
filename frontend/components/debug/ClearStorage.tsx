'use client'

import { Button } from '@/components/ui/button'
import { useNavigationStore } from '@/lib/stores/navigationStore'

/**
 * Debug component to clear localStorage
 *
 * Use this if you see old cached data (like bulletproof-react path)
 *
 * To use: Import and add to any page temporarily
 * <ClearStorage />
 */
export function ClearStorage() {
  const handleClear = () => {
    // Clear all localStorage
    localStorage.clear()

    // Reload page
    window.location.reload()
  }

  const handleClearNav = () => {
    // Clear only navigation storage
    localStorage.removeItem('navigation-storage')

    // Reset store
    const store = useNavigationStore.getState()
    store.reset()

    // Reload page
    window.location.reload()
  }

  return (
    <div className="fixed bottom-4 right-4 p-4 bg-yellow-100 border-2 border-yellow-500 rounded-lg shadow-lg z-50">
      <h3 className="font-bold text-sm mb-2">Debug: Clear Storage</h3>
      <div className="flex flex-col gap-2">
        <Button size="sm" variant="outline" onClick={handleClearNav}>
          Clear Navigation Cache
        </Button>
        <Button size="sm" variant="destructive" onClick={handleClear}>
          Clear All Storage
        </Button>
      </div>
      <p className="text-xs mt-2 text-gray-600">
        Use if you see old cached paths
      </p>
    </div>
  )
}
