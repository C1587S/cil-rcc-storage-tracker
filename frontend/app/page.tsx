'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSnapshots } from '@/lib/hooks/useSnapshots'

export default function HomePage() {
  const router = useRouter()
  const { data: snapshotsData, isLoading } = useSnapshots()

  // Auto-redirect to latest snapshot
  useEffect(() => {
    if (!isLoading && snapshotsData && snapshotsData.snapshots.length > 0) {
      const latestSnapshot = snapshotsData.snapshots[0]
      router.push(`/dashboard/${latestSnapshot.date}`)
    }
  }, [isLoading, snapshotsData, router])

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

  // While redirecting, show loading state
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-semibold mb-2">Redirecting to Latest Dashboard...</h2>
        <p className="text-muted-foreground">Loading your most recent snapshot</p>
      </div>
    </div>
  )
}
