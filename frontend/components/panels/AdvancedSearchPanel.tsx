'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Search, Filter, X } from 'lucide-react'
import { formatBytes, formatRelativeTime, formatFileName } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils'

interface AdvancedSearchPanelProps {
  snapshot: string
}

export function AdvancedSearchPanel({ snapshot }: AdvancedSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [minSize, setMinSize] = useState('')
  const [maxSize, setMaxSize] = useState('')
  const [fileType, setFileType] = useState('')
  const [shouldSearch, setShouldSearch] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['search', query, snapshot, isRegex, minSize, maxSize, fileType],
    queryFn: () =>
      searchApi.files({
        q: query,
        snapshot,
        regex: isRegex,
        limit: 100,
        min_size: minSize ? parseInt(minSize) : undefined,
        max_size: maxSize ? parseInt(maxSize) : undefined,
        file_type: fileType || undefined,
      }),
    enabled: shouldSearch && !!query && !!snapshot,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      setShouldSearch(true)
    }
  }

  const clearFilters = () => {
    setMinSize('')
    setMaxSize('')
    setFileType('')
  }

  const parseSize = (sizeStr: string): number | null => {
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([KMGT]?B)?$/i)
    if (!match) return null

    const value = parseFloat(match[1])
    const unit = (match[2] || 'B').toUpperCase()

    const multipliers: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 ** 2,
      'GB': 1024 ** 3,
      'TB': 1024 ** 4,
    }

    return value * (multipliers[unit] || 1)
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Advanced File Search
        </CardTitle>
        <CardDescription>
          Search using patterns, regular expressions, or SQL-like filters
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Search Input */}
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="flex gap-2">
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g., *.py, data_202[0-9].csv, name:*.txt, path:/project/*/data"
              className="flex-1 font-mono text-sm"
            />
            <Button type="submit" disabled={!query.trim() || isLoading}>
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>

          {/* Quick Examples */}
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="text-muted-foreground">Examples:</span>
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => setQuery('*.py')}
            >
              *.py
            </button>
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => setQuery('data_*.csv')}
            >
              data_*.csv
            </button>
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => {
                setQuery('log')
                setIsRegex(true)
              }}
            >
              /log/i (regex)
            </button>
          </div>

          {/* Advanced Filters */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters</span>
              {(minSize || maxSize || fileType) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-6 px-2 text-xs"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Min Size (e.g., 10MB)
                </label>
                <Input
                  type="text"
                  value={minSize}
                  onChange={(e) => setMinSize(e.target.value)}
                  placeholder="10MB"
                  className="text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Max Size (e.g., 1GB)
                </label>
                <Input
                  type="text"
                  value={maxSize}
                  onChange={(e) => setMaxSize(e.target.value)}
                  placeholder="1GB"
                  className="text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  File Type
                </label>
                <Input
                  type="text"
                  value={fileType}
                  onChange={(e) => setFileType(e.target.value)}
                  placeholder="py, csv, log"
                  className="text-sm"
                />
              </div>
            </div>

            {/* Regex Toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="regex-mode"
                checked={isRegex}
                onChange={(e) => setIsRegex(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="regex-mode" className="text-sm cursor-pointer">
                Use Regular Expression
              </label>
            </div>
          </div>
        </form>

        {/* Results */}
        {isLoading && (
          <div className="text-center py-8 text-muted-foreground">
            Searching...
          </div>
        )}

        {error && (
          <div className="text-center py-8 text-destructive">
            Error: {(error as any)?.detail || 'Failed to search'}
          </div>
        )}

        {data && (
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                Found {data.total.toLocaleString()} results
                {data.took_ms && (
                  <span className="text-muted-foreground ml-2">
                    ({data.took_ms}ms)
                  </span>
                )}
              </div>
              {data.total > data.results.length && (
                <Badge variant="secondary">
                  Showing first {data.results.length}
                </Badge>
              )}
            </div>

            <div className="space-y-1 max-h-96 overflow-y-auto">
              {data.results.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground italic">
                  No files match your search criteria
                </div>
              ) : (
                data.results.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-start justify-between gap-4 p-3 rounded hover:bg-accent group transition-colors"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="font-mono text-sm font-medium truncate" title={file.path}>
                        {formatFileName(file.path)}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        {file.parent_path}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{formatBytes(file.size)}</span>
                        <span>•</span>
                        <span>{file.file_type}</span>
                        <span>•</span>
                        <span>Modified {formatRelativeTime(file.modified_time)}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
