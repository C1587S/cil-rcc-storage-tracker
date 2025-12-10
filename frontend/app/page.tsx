'use client'

import { useRouter } from 'next/navigation'
import { useSnapshots } from '@/lib/hooks/useSnapshots'
import { SnapshotCalendar } from '@/components/visualizations/SnapshotCalendar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Calendar, BarChart3 } from 'lucide-react'

export default function HomePage() {
  const router = useRouter()
  const { data: snapshotsData, isLoading } = useSnapshots()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">Loading Storage Analytics...</h2>
          <p className="text-muted-foreground">Fetching snapshot data</p>
        </div>
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

  const latestSnapshot = snapshotsData.snapshots[0]

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="border-b">
        <div className="container mx-auto px-6 py-12">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold mb-2">Storage Analytics System</h1>
              <p className="text-lg text-muted-foreground">
                Explore and analyze your storage usage across {snapshotsData.count} snapshots
              </p>
            </div>
            <Button
              size="lg"
              onClick={() => router.push(`/dashboard/${latestSnapshot.date}`)}
              className="gap-2"
            >
              <BarChart3 className="h-5 w-5" />
              View Latest Dashboard
            </Button>
          </div>
        </div>
      </div>

      {/* Calendar Section */}
      <div className="container mx-auto px-6 py-12">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              <CardTitle>Snapshot History Calendar</CardTitle>
            </div>
            <CardDescription>
              Click on any day to view that snapshot. Color intensity represents storage size.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SnapshotCalendar />
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Latest Snapshot
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{latestSnapshot.date}</div>
              <p className="text-sm text-muted-foreground mt-1">
                {latestSnapshot.file_count.toLocaleString()} files
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Snapshots
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{snapshotsData.count}</div>
              <p className="text-sm text-muted-foreground mt-1">
                Historical records available
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Top Level Directories
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {latestSnapshot.top_level_dirs?.length || 0}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Scanned directories
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
