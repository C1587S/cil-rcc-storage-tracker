import { useState, useCallback, useRef } from 'react'

/**
 * Options for useVoronoiNavigation hook
 */
interface UseVoronoiNavigationOptions {
  basePath: string
  onNavigate?: () => void
}

/**
 * React hook for managing voronoi visualization navigation state.
 * Handles drill-down navigation, history, breadcrumb navigation, and locking.
 * Uses ref pattern to prevent stale closures in D3 event handlers.
 *
 * @param options - Configuration options
 * @returns Navigation state and control functions
 */
export function useVoronoiNavigation({ basePath, onNavigate }: UseVoronoiNavigationOptions) {
  const [viewingPath, setViewingPath] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [navigationLock, setNavigationLock] = useState(false)
  const navigationLockRef = useRef(false)

  // Store onNavigate in a ref so it doesn't cause re-renders
  const onNavigateRef = useRef(onNavigate)
  onNavigateRef.current = onNavigate

  const effectivePath = viewingPath || basePath
  const effectivePathRef = useRef(effectivePath)
  effectivePathRef.current = effectivePath

  // DRILL DOWN - reads from ref for current path
  const performDrillDown = useCallback((targetPath: string) => {
    const currentPath = effectivePathRef.current

    if (navigationLockRef.current) {
      return
    }

    if (!targetPath || targetPath === currentPath) {
      return
    }

    navigationLockRef.current = true
    setNavigationLock(true)

    setHistory(prev => [...prev, currentPath])
    setViewingPath(targetPath)
    onNavigateRef.current?.()
  }, [])

  const navigateBack = useCallback(() => {
    if (navigationLockRef.current || history.length === 0) return

    navigationLockRef.current = true
    setNavigationLock(true)

    const newHistory = [...history]
    const previousPath = newHistory.pop()!

    setHistory(newHistory)
    setViewingPath(previousPath === basePath ? null : previousPath)
    onNavigateRef.current?.()
  }, [history, basePath])

  const navigateToBreadcrumb = useCallback((targetPath: string) => {
    if (navigationLockRef.current || targetPath === effectivePath) return

    navigationLockRef.current = true
    setNavigationLock(true)

    const historyIndex = history.indexOf(targetPath)

    if (targetPath === basePath) {
      setHistory([])
      setViewingPath(null)
    } else if (historyIndex >= 0) {
      setHistory(history.slice(0, historyIndex))
      setViewingPath(targetPath)
    }

    onNavigateRef.current?.()
  }, [history, basePath, effectivePath])

  const unlockNavigation = useCallback(() => {
    setNavigationLock(false)
    navigationLockRef.current = false
  }, [])

  return {
    viewingPath,
    history,
    navigationLock,
    effectivePath,
    effectivePathRef,
    performDrillDown,
    navigateBack,
    navigateToBreadcrumb,
    unlockNavigation,
  }
}
