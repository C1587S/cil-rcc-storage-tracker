'use client'

import { useMemo, useState } from 'react'
import { useSnapshots } from '@/lib/hooks/useSnapshots'
import { useRouter } from 'next/navigation'
import { ResponsiveCalendar } from '@nivo/calendar'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Extrae YYYY-MM-DD de un snapshot date
 * Ej: "2025-12-12-test" -> "2025-12-12"
 */
function normalizeDate(date: string): string | null {
  const base = date.slice(0, 10)
  const d = new Date(base)
  return isNaN(d.getTime()) ? null : base
}

export function SnapshotCalendar() {
  const { data: snapshotsData, isLoading } = useSnapshots()
  const router = useRouter()

  const snapshots = snapshotsData?.snapshots ?? []

  // Get available years from snapshots
  const availableYears = useMemo(() => {
    const years = snapshots
      .map(s => normalizeDate(s.date))
      .filter(Boolean)
      .map(d => new Date(d as string).getFullYear())
    return Array.from(new Set(years)).sort((a, b) => b - a) // newest first
  }, [snapshots])

  // Default to the first (newest) available year
  const [selectedYear, setSelectedYear] = useState<number>(
    availableYears[0] || new Date().getFullYear()
  )

  // Update selected year when available years change
  useMemo(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0])
    }
  }, [availableYears, selectedYear])

  // ---- Calendar data (Nivo necesita YYYY-MM-DD válido) ----
  const calendarData = useMemo(() => {
    return snapshots
      .map(snapshot => {
        const day = normalizeDate(snapshot.date)
        if (!day) return null

        return {
          day,
          value: snapshot.total_size || 1,
          originalDate: snapshot.date // ← guardamos el id real
        }
      })
      .filter(Boolean) as {
        day: string
        value: number
        originalDate: string
      }[]
  }, [snapshots])

  // ---- Date range - ONLY show selected year ----
  const dateRange = useMemo(() => {
    return {
      from: `${selectedYear}-01-01`,
      to: `${selectedYear}-12-31`
    }
  }, [selectedYear])

  // ---- Loading ----
  if (isLoading) {
    return (
      <div className="h-32 flex items-center justify-center text-muted-foreground">
        <div className="animate-pulse">Loading calendar...</div>
      </div>
    )
  }

  // ---- Empty ----
  if (calendarData.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>No snapshots available</p>
          <p className="text-xs mt-2">
            Scan a directory to create your first snapshot
          </p>
        </div>
      </div>
    )
  }

  // Navigation handlers
  const canGoPrevious = availableYears.indexOf(selectedYear) < availableYears.length - 1
  const canGoNext = availableYears.indexOf(selectedYear) > 0

  const goToPreviousYear = () => {
    const currentIndex = availableYears.indexOf(selectedYear)
    if (currentIndex < availableYears.length - 1) {
      setSelectedYear(availableYears[currentIndex + 1])
    }
  }

  const goToNextYear = () => {
    const currentIndex = availableYears.indexOf(selectedYear)
    if (currentIndex > 0) {
      setSelectedYear(availableYears[currentIndex - 1])
    }
  }

  // ---- Render ----
  return (
    <div className="w-full">
      {/* Year selector - only show if multiple years available */}
      {availableYears.length > 1 && (
        <div className="flex items-center justify-center gap-4 mb-4">
          <button
            onClick={goToPreviousYear}
            disabled={!canGoPrevious}
            className="p-1 rounded hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous year"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-gray-400">Year:</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-gray-800 text-gray-200 border border-gray-700 rounded px-3 py-1 text-sm font-mono focus:outline-none focus:border-orange-500"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={goToNextYear}
            disabled={!canGoNext}
            className="p-1 rounded hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next year"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Calendar - single year only, fixed height */}
      <div className="w-full h-[180px]">
        <ResponsiveCalendar
          data={calendarData}
          from={dateRange.from}
          to={dateRange.to}
          emptyColor="#161b22"
          colors={['#ff990033', '#ff990066', '#ff990099', '#ff9900cc', '#ff9900']}
          margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
          monthBorderColor="#30363d"
          dayBorderWidth={2}
          dayBorderColor="#30363d"
          direction="horizontal"
          minValue={0}
          maxValue="auto"
          theme={{
            background: '#0a0e14',
            text: {
              fontSize: 11,
              fill: '#c0c0c0',
              fontFamily: 'monospace'
            },
            labels: {
              text: {
                fill: '#c0c0c0',
                fontFamily: 'monospace'
              }
            }
          }}
          legends={[]}
          onClick={(day) => {
            const match = calendarData.find(d => d.day === day.day)
            if (match) {
              router.push(`/dashboard/${match.originalDate}`)
            }
          }}
          tooltip={({ day, value }) => (
            <div
              style={{
                background: '#161b22',
                padding: '9px 12px',
                border: '1px solid #30363d',
                borderRadius: '4px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                color: '#c0c0c0',
                fontFamily: 'monospace',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              <strong style={{ color: '#ffffff' }}>{day}</strong>
              <br />
              {value ? (
                <span style={{ color: '#ff9900' }}>
                  Snapshot available – click to view
                </span>
              ) : (
                <span style={{ color: '#606060' }}>No snapshot</span>
              )}
            </div>
          )}
        />
      </div>
    </div>
  )
}
