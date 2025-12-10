'use client'

import { useRouter } from 'next/navigation'
import { useSnapshots } from '@/lib/hooks/useSnapshots'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function SnapshotSelector({ currentSnapshot }: { currentSnapshot: string }) {
  const router = useRouter()
  const { data } = useSnapshots()

  const handleChange = (value: string) => {
    router.push(`/dashboard/${value}`)
  }

  return (
    <Select value={currentSnapshot} onValueChange={handleChange}>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select snapshot" />
      </SelectTrigger>
      <SelectContent>
        {data?.snapshots.map((snapshot) => (
          <SelectItem key={snapshot.date} value={snapshot.date}>
            {snapshot.date}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
