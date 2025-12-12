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
        <Button variant="outline" className="gap-2 font-mono border-[#30363d] hover:bg-[#161b22]">
          <Calendar className="h-4 w-4 text-[#ff9900]" />
          <span className="text-[#ff9900]">{currentSnapshot}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-full w-[95vw] max-h-[90vh] overflow-auto bg-[#0a0e14] border-[#30363d]">
        <DialogHeader>
          <DialogTitle className="font-mono text-[#ffffff]">Select Snapshot</DialogTitle>
          <p className="text-sm text-[#c0c0c0] font-mono">
            Click on any date to view that snapshot
          </p>
        </DialogHeader>

        <div className="mt-4">
          <SnapshotCalendar />
        </div>

        <div className="mt-4 p-4 bg-[#161b22] border border-[#30363d] rounded-lg">
          <div className="grid grid-cols-2 gap-4 text-sm font-mono">
            <div>
              <div className="text-[#606060] text-xs mb-1">Total Snapshots</div>
              <div className="font-semibold text-[#ff9900]">{snapshotsData.snapshots.length}</div>
            </div>
            <div>
              <div className="text-[#606060] text-xs mb-1">Currently Viewing</div>
              <div className="font-semibold text-[#ff9900]">{currentSnapshot}</div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
