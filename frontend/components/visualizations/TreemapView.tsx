'use client'

import { ResponsiveTreeMap } from '@nivo/treemap'
import { vizApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'

export function TreemapView({ path, snapshot }: { path: string; snapshot: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['treemap', path, snapshot],
    queryFn: () => vizApi.treemap(path, snapshot, 2),
    enabled: !!snapshot,
  })

  if (isLoading) return <div>Loading treemap...</div>
  if (!data) return <div>No data available</div>

  return (
    <ResponsiveTreeMap
      data={data}
      identity="name"
      value="size"
      valueFormat=" >-$.2~s"
      margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
      labelSkipSize={12}
      colors={{ scheme: 'nivo' }}
      borderColor={{ from: 'color', modifiers: [['darker', 0.3]] }}
      animate={true}
    />
  )
}
