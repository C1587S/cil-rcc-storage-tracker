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
        emptyColor="#161b22"
        colors={['#ff990033', '#ff990066', '#ff990099', '#ff9900cc', '#ff9900']}
        margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
        yearSpacing={40}
        monthBorderColor="#30363d"
        dayBorderWidth={2}
        dayBorderColor="#30363d"
        theme={{
          background: '#0a0e14',
          textColor: '#c0c0c0',
          fontSize: 11,
          labels: {
            text: {
              fill: '#c0c0c0',
              fontFamily: 'monospace'
            }
          }
        }}
        onClick={(day) => {
          if (day.value) {
            router.push(`/dashboard/${day.day}`)
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
              fontSize: '12px'
            }}
          >
            <strong style={{ color: '#ffffff' }}>{day}</strong>
            <br />
            {value ? (
              <span style={{ color: '#ff9900' }}>Snapshot available - Click to view</span>
            ) : (
              <span style={{ color: '#606060' }}>No snapshot</span>
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
