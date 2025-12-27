import { ChevronLeft, Search, AlertCircle } from 'lucide-react'
import { useState, useMemo, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { type VoronoiNode } from '@/lib/voronoi-data-adapter'

interface BreadcrumbPart {
  name: string
  path: string
  isClickable: boolean
}

interface VoronoiBreadcrumbProps {
  breadcrumbParts: BreadcrumbPart[]
  canGoBack: boolean
  isLocked: boolean
  currentData: VoronoiNode | null | undefined
  onNavigateBack: () => void
  onNavigateToBreadcrumb: (path: string) => void
  onDrillDown: (path: string) => void
}

export function VoronoiBreadcrumb({
  breadcrumbParts,
  canGoBack,
  isLocked,
  currentData,
  onNavigateBack,
  onNavigateToBreadcrumb,
  onDrillDown
}: VoronoiBreadcrumbProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Get current path for display
  const currentPath = breadcrumbParts[breadcrumbParts.length - 1]?.path || '/'

  // Get available child directories
  const availableChildren = useMemo(() => {
    if (!currentData || !currentData.children) return []
    return currentData.children
      .filter(child => child.is_directory && !child.isSynthetic)
      .map(child => ({
        name: child.name,
        path: child.path,
        size: child.size
      }))
      .sort((a, b) => b.size - a.size) // Sort by size descending
  }, [currentData])

  // Filter children based on search query
  const filteredChildren = useMemo(() => {
    if (!searchQuery.trim()) return availableChildren
    const query = searchQuery.toLowerCase()
    return availableChildren.filter(child =>
      child.name.toLowerCase().includes(query)
    )
  }, [availableChildren, searchQuery])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Show dropdown when typing
  useEffect(() => {
    if (searchQuery.trim()) {
      setShowDropdown(true)
      setErrorMessage('')
    } else {
      setShowDropdown(false)
      setErrorMessage('')
    }
  }, [searchQuery])

  const handleNavigateToChild = (path: string) => {
    onDrillDown(path)
    setSearchQuery('')
    setShowDropdown(false)
    setErrorMessage('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const query = searchQuery.trim()

      if (!query) return

      // Try to find exact match first
      const exactMatch = availableChildren.find(child =>
        child.name.toLowerCase() === query.toLowerCase()
      )

      if (exactMatch) {
        handleNavigateToChild(exactMatch.path)
      } else if (filteredChildren.length === 1) {
        // If only one match, navigate to it
        handleNavigateToChild(filteredChildren[0].path)
      } else if (filteredChildren.length === 0) {
        // No matches - show error
        setErrorMessage(`Folder "${query}" does not exist in current directory`)
        setShowDropdown(false)
      } else {
        // Multiple matches - keep dropdown open
        setErrorMessage('')
      }
    } else if (e.key === 'Escape') {
      setSearchQuery('')
      setShowDropdown(false)
      setErrorMessage('')
      inputRef.current?.blur()
    }
  }

  return (
    <div className="bg-[#0a0e14] border border-gray-800 rounded flex flex-col gap-2 p-2">
      {/* Top row: Back button + Breadcrumb path */}
      <div className="flex items-center gap-2">
        <button
          onClick={onNavigateBack}
          disabled={!canGoBack || isLocked}
          className={cn(
            "flex items-center justify-center w-7 h-7 rounded border transition-all shrink-0",
            canGoBack && !isLocked
              ? "border-gray-700 hover:border-cyan-600 hover:bg-cyan-950/30 text-gray-400 hover:text-cyan-400 cursor-pointer"
              : "border-gray-800 text-gray-700 cursor-not-allowed"
          )}
          title="Go back"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-gray-700">|</span>
        <span className="text-green-500 font-bold">$</span>
        {breadcrumbParts.map((part, i) => (
          <div key={`${part.path}-${i}`} className="flex items-center gap-1">
            <button
              onClick={() => part.isClickable && !isLocked && onNavigateToBreadcrumb(part.path)}
              disabled={!part.isClickable || isLocked}
              className={cn(
                "transition-colors whitespace-nowrap",
                part.isClickable && !isLocked
                  ? "hover:text-cyan-400 text-gray-400 cursor-pointer"
                  : "text-white cursor-default font-bold"
              )}
            >
              {part.name}
            </button>
            {i < breadcrumbParts.length - 1 && <span className="text-gray-700">/</span>}
          </div>
        ))}
      </div>

      {/* Bottom row: Search input with autocomplete */}
      <div className="relative" ref={dropdownRef}>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-600" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLocked}
            placeholder={`Navigate from ${currentPath}...`}
            className={cn(
              "w-full bg-black/30 border rounded pl-7 pr-3 py-1 text-xs text-white placeholder-gray-600 focus:outline-none transition-colors",
              errorMessage
                ? "border-yellow-600 focus:border-yellow-500"
                : "border-gray-700 focus:border-cyan-600",
              isLocked && "cursor-not-allowed opacity-50"
            )}
          />
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="mt-1 flex items-center gap-1 text-yellow-500 text-xs">
            <AlertCircle className="w-3 h-3" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Autocomplete dropdown */}
        {showDropdown && filteredChildren.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#0a0e14] border border-cyan-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
            {filteredChildren.map((child, idx) => (
              <button
                key={idx}
                onClick={() => handleNavigateToChild(child.path)}
                className="w-full text-left px-3 py-2 hover:bg-cyan-950/30 text-gray-300 hover:text-cyan-400 border-b border-gray-800/50 last:border-b-0 transition-colors text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="truncate">{child.name}</span>
                  <span className="text-gray-600 text-[10px] ml-2 shrink-0">
                    {(child.size / (1024 ** 4)).toFixed(2)} TB
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
