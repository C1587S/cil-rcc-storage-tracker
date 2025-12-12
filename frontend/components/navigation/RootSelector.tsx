'use client'

import { useEffect } from 'react'
import { FolderTree } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useNavigationStore } from '@/lib/stores/navigationStore'
import { useSnapshot } from '@/lib/hooks/useSnapshots'

interface RootSelectorProps {
  snapshot: string
}

/**
 * Root/Directory Selector Component
 *
 * Allows users to select which top-level directory to explore from a snapshot.
 * Each snapshot may contain multiple scan roots (e.g., beagle, cortex, hydra, etc.)
 *
 * This component:
 * - Fetches available top-level directories from the snapshot
 * - Displays them in a dropdown
 * - Updates the navigation store when a new root is selected
 */
export function RootSelector({ snapshot }: RootSelectorProps) {
  const { scanRoot, setScanRoot } = useNavigationStore()
  const { data: snapshotData, isLoading, error } = useSnapshot(snapshot)

  // Extract top-level directories from snapshot data
  const topLevelDirs = snapshotData?.top_level_dirs || []

  // Auto-select first directory if none selected and directories are available
  useEffect(() => {
    if (topLevelDirs.length > 0 && !scanRoot) {
      const firstDir = topLevelDirs[0]
      setScanRoot(firstDir)
    }
  }, [topLevelDirs, scanRoot, setScanRoot])

  const handleRootChange = (newRoot: string) => {
    setScanRoot(newRoot)
  }

  // Extract directory name from full path for display
  const getDisplayName = (path: string): string => {
    if (!path) return 'Select Root'
    const parts = path.split('/').filter(Boolean)
    return parts[parts.length - 1] || path
  }

  // Show loading or error states
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FolderTree className="h-4 w-4" />
        <span>Loading directories...</span>
      </div>
    )
  }

  if (error || topLevelDirs.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FolderTree className="h-4 w-4" />
        <span>No directories available</span>
      </div>
    )
  }

  // Single directory - show as static text
  if (topLevelDirs.length === 1) {
    return (
      <div className="flex items-center gap-2">
        <FolderTree className="h-4 w-4 text-[#ff9900]" />
        <span className="text-sm font-medium">{getDisplayName(topLevelDirs[0])}</span>
      </div>
    )
  }

  // Multiple directories - show select dropdown
  return (
    <div className="flex items-center gap-2">
      <FolderTree className="h-4 w-4 text-[#ff9900]" />
      <Select value={scanRoot} onValueChange={handleRootChange}>
        <SelectTrigger className="w-[200px] h-9">
          <SelectValue placeholder="Select a directory">
            {scanRoot ? getDisplayName(scanRoot) : 'Select Root'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {topLevelDirs.map((dir) => (
            <SelectItem key={dir} value={dir}>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{getDisplayName(dir)}</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {dir}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
