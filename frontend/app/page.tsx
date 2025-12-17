'use client'

import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useSnapshots } from '@/lib/hooks/useSnapshots'

export default function HomePage() {
  const { data: snapshotsData, isLoading } = useSnapshots()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!snapshotsData || snapshotsData.snapshots.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">No Snapshots Available</h2>
          <p className="text-muted-foreground">
            Please run the scanner to generate snapshot data
          </p>
        </div>
      </div>
    )
  }

  // Show dashboard with prompt to select snapshot
  return (
    <DashboardLayout snapshot="">
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <Card className="w-full max-w-md mx-4">
          <CardHeader>
            <CardTitle>Welcome to Storage Analytics</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Please select a snapshot from the dropdown above to begin exploring your storage data.
            </p>
            <div className="text-sm text-muted-foreground">
              <p className="font-semibold mb-2">Available snapshots:</p>
              <ul className="list-disc list-inside space-y-1">
                {snapshotsData.snapshots.map((snapshot) => (
                  <li key={snapshot.date} className="font-mono">
                    {snapshot.date}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
