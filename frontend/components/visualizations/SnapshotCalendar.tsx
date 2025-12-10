'use client'

import { ResponsiveCalendar } from '@nivo/calendar'
import { useSnapshots } from '@/lib/hooks/useSnapshots'
import { formatBytes } from '@/lib/utils/formatters'
import { useRouter } from 'next/navigation'

export function SnapshotCalendar() {
  const { data: snapshotsData, isLoading } = useSnapshots()
  const router = useRouter()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        Loading snapshot history...
      </div>
    )
  }

  if (!snapshotsData || !snapshotsData.snapshots || snapshotsData.snapshots.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        No snapshots available
      </div>
    )
  }

  const snapshots = snapshotsData.snapshots

  // Transform snapshots into calendar data format
  const calendarData = snapshots.map(snapshot => ({
    day: snapshot.date,
    value: snapshot.total_size,
  }))

  // Get date range
  const dates = snapshots.map(s => new Date(s.date))
  const minDate = new Date(Math.min(...dates.map(d => d.getTime())))
  const maxDate = new Date(Math.max(...dates.map(d => d.getTime())))

  // Extend range to show full year or at least 6 months
  const startDate = new Date(minDate)
  startDate.setMonth(startDate.getMonth() - 1)
  const endDate = new Date(maxDate)
  endDate.setMonth(endDate.getMonth() + 1)

  // Create a map for quick lookup
  const snapshotMap = new Map(snapshots.map(s => [s.date, s]))

  return (
    <div className="h-48">
      <ResponsiveCalendar
        data={calendarData}
        from={startDate.toISOString().split('T')[0]}
        to={endDate.toISOString().split('T')[0]}
        emptyColor="#eeeeee"
        colors={['#a1cfff', '#468df3', '#a053f0', '#9629f0', '#8428d0']}
        margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
        yearSpacing={40}
        monthBorderColor="#ffffff"
        dayBorderWidth={2}
        dayBorderColor="#ffffff"
        tooltip={({ day, value, color }) => {
          const snapshot = snapshotMap.get(day)
          if (!snapshot) {
            return (
              <div className="bg-background border border-border rounded-lg shadow-lg p-2 text-xs">
                <div className="font-semibold">{day}</div>
                <div className="text-muted-foreground">No snapshot</div>
              </div>
            )
          }

          return (
            <div className="bg-background border border-border rounded-lg shadow-lg p-3">
              <div className="font-semibold text-sm mb-2">{day}</div>
              <div className="text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Total Size:</span>
                  <span className="font-medium">{formatBytes(snapshot.total_size)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Files:</span>
                  <span className="font-medium">{snapshot.file_count.toLocaleString()}</span>
                </div>
                <div className="text-primary italic mt-2 text-[10px]">
                  Click to view this snapshot
                </div>
              </div>
            </div>
          )
        }}
        onClick={(datum) => {
          if (datum.value) {
            router.push(`/dashboard/${datum.day}`)
          }
        }}
        legends={[
          {
            anchor: 'bottom-right',
            direction: 'row',
            itemCount: 4,
            itemWidth: 42,
            itemHeight: 36,
            itemsSpacing: 14,
            itemDirection: 'right-to-left',
          },
        ]}
      />
    </div>
  )
}
