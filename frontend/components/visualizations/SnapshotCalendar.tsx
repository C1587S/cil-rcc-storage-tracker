'use client'

import { useMemo } from 'react'
import { useSnapshots } from '@/lib/hooks/useSnapshots'
import { useRouter } from 'next/navigation'
import { ResponsiveCalendar } from '@nivo/calendar'

export function SnapshotCalendar() {
  const { data: snapshotsData, isLoading } = useSnapshots()
  const router = useRouter()

  const snapshots = snapshotsData?.snapshots ?? []

  // Transform snapshots to Nivo calendar format
  const calendarData = useMemo(() => {
    return snapshots.map(snapshot => ({
      day: snapshot.date,
      value: snapshot.total_size || 1, // Use total size as the value for color intensity
    }))
  }, [snapshots])

  // Calculate date range
  const dateRange = useMemo(() => {
    if (snapshots.length === 0) {
      const today = new Date()
      const oneYearAgo = new Date()
      oneYearAgo.setFullYear(today.getFullYear() - 1)
      return {
        from: oneYearAgo.toISOString().split('T')[0],
        to: today.toISOString().split('T')[0]
      }
    }

    const dates = snapshots.map(s => new Date(s.date))
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())))
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())))

    return {
      from: minDate.toISOString().split('T')[0],
      to: maxDate.toISOString().split('T')[0]
    }
  }, [snapshots])

  if (isLoading) {
    return (
      <div className="h-32 flex items-center justify-center text-muted-foreground">
        <div className="animate-pulse">Loading calendar...</div>
      </div>
    )
  }

  if (snapshots.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>No snapshots available</p>
          <p className="text-xs mt-2">Scan a directory to create your first snapshot</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-32 w-full">
      <ResponsiveCalendar
        data={calendarData}
        from={dateRange.from}
        to={dateRange.to}
        emptyColor="#eeeeee"
        colors={['#d6e4ff', '#adc6ff', '#85a5ff', '#597ef7', '#2f54eb', '#1d39c4', '#10239e']}
        margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
        yearSpacing={40}
        monthBorderColor="#ffffff"
        dayBorderWidth={2}
        dayBorderColor="#ffffff"
        onClick={(day) => {
          // Navigate to snapshot when a day is clicked
          router.push(`/dashboard/${day.day}`)
        }}
        tooltip={({ day, value, color }) => (
          <div
            style={{
              background: 'white',
              padding: '9px 12px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}
          >
            <strong>{day}</strong>
            <br />
            {value ? (
              <span>Snapshot available</span>
            ) : (
              <span style={{ color: '#999' }}>No snapshot</span>
            )}
          </div>
        )}
        legends={[
          {
            anchor: 'bottom-right',
            direction: 'row',
            translateY: 36,
            itemCount: 4,
            itemWidth: 42,
            itemHeight: 36,
            itemsSpacing: 14,
            itemDirection: 'right-to-left'
          }
        ]}
      />
    </div>
  )
}
