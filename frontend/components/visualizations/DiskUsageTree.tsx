'use client'

import { vizApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { formatBytes } from '@/lib/utils/formatters'

export function DiskUsageTree({ path, snapshot }: { path: string; snapshot: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['disk-usage', path, snapshot],
    queryFn: () => vizApi.diskUsage(path, snapshot),
    enabled: !!snapshot,
  })

  if (isLoading) return <div>Loading...</div>
  if (!data) return <div>No data available</div>

  return (
    <div className="space-y-2">
      {data.items.map((item) => (
        <div key={item.path} className="flex items-center gap-4">
          <div className="flex-1 font-mono text-sm truncate">{item.name}</div>
          <div className="w-64 bg-secondary rounded-full h-6 overflow-hidden">
            <div
              className="h-full bg-primary flex items-center px-2"
              style={{ width: `${item.percentage}%` }}
            >
              <span className="text-xs text-white">{formatBytes(item.size)}</span>
            </div>
          </div>
          <span className="text-sm w-12 text-right">{item.percentage.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  )
}
