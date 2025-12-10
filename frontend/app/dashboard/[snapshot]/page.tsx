'use client'

import { use } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { TreemapView } from '@/components/visualizations/TreemapView'
import { DiskUsageTree } from '@/components/visualizations/DiskUsageTree'
import { HeavyFilesPanel } from '@/components/panels/HeavyFilesPanel'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useNavigationStore } from '@/lib/stores/navigationStore'
import { useFolderData } from '@/lib/hooks/useFolderData'
import { useSnapshot } from '@/lib/hooks/useSnapshots'
import { formatBytes, formatNumber } from '@/lib/utils/formatters'

export default function DashboardPage({
  params,
}: {
  params: Promise<{ snapshot: string }>
}) {
  const { snapshot } = use(params)
  const { currentPath } = useNavigationStore()
  const { data: snapshotData } = useSnapshot(snapshot)
  const { data: folderData, isLoading } = useFolderData(currentPath, snapshot, 2)

  return (
    <DashboardLayout snapshot={snapshot}>
      <div className="p-6 space-y-6">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Total Files</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {snapshotData ? formatNumber(snapshotData.file_count) : '-'}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Total Size</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {snapshotData ? formatBytes(snapshotData.total_size) : '-'}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Current Path</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm font-mono truncate">{currentPath}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Items Here</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {folderData ? formatNumber(folderData.file_count) : '-'}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Visualizations */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Storage Treemap</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <TreemapView path={currentPath} snapshot={snapshot} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Disk Usage Tree</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px] overflow-y-auto">
                <DiskUsageTree path={currentPath} snapshot={snapshot} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Heavy Files Panel */}
        <HeavyFilesPanel snapshot={snapshot} />
      </div>
    </DashboardLayout>
  )
}
