'use client'

import { useState } from 'react'
import { useSnapshots } from '@/lib/hooks/useSnapshots'
import { SnapshotCalendar } from '@/components/visualizations/SnapshotCalendar'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Calendar } from 'lucide-react'

interface SnapshotCalendarSelectorProps {
  currentSnapshot: string
}

export function SnapshotCalendarSelector({ currentSnapshot }: SnapshotCalendarSelectorProps) {
  const { data: snapshotsData } = useSnapshots()
  const [isOpen, setIsOpen] = useState(false)

  if (!snapshotsData || snapshotsData.snapshots.length === 0) {
    return (
      <Button variant="outline" disabled>
        <Calendar className="h-4 w-4 mr-2" />
        No Snapshots
      </Button>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Calendar className="h-4 w-4" />
          {currentSnapshot}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-full w-[95vw] max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Select Snapshot</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Click on any neon green date to view that snapshot
          </p>
        </DialogHeader>

        <div className="mt-4">
          <SnapshotCalendar />
        </div>

        <div className="mt-4 p-4 bg-muted rounded-lg">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs mb-1">Total Snapshots</div>
              <div className="font-semibold">{snapshotsData.snapshots.length}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-1">Currently Viewing</div>
              <div className="font-semibold">{currentSnapshot}</div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
