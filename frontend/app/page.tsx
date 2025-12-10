'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useLatestSnapshot } from '@/lib/hooks/useSnapshots'

export default function HomePage() {
  const router = useRouter()
  const { data: latestSnapshot, isLoading } = useLatestSnapshot()

  useEffect(() => {
    if (latestSnapshot?.date) {
      router.push(`/dashboard/${latestSnapshot.date}`)
    }
  }, [latestSnapshot, router])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">Loading Storage Analytics...</h2>
          <p className="text-muted-foreground">Fetching latest snapshot data</p>
        </div>
      </div>
    )
  }

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
