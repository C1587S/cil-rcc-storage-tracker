'use client'

import { useState } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { TreemapView } from '@/components/visualizations/TreemapView'
import { DiskUsageTree } from '@/components/visualizations/DiskUsageTree'
import { CirclePackView } from '@/components/visualizations/CirclePackView'
import { HeavyFilesPanel } from '@/components/panels/HeavyFilesPanel'
import { AdvancedSearchPanel } from '@/components/panels/AdvancedSearchPanel'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useNavigationStore } from '@/lib/stores/navigationStore'
import { useFolderData } from '@/lib/hooks/useFolderData'
import { useSnapshot } from '@/lib/hooks/useSnapshots'
import { formatBytes, formatNumber } from '@/lib/utils/formatters'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface DashboardPageProps {
  params: {
    snapshot: string
  }
}

function CollapsibleDiskUsageTree({ path, snapshot }: { path: string; snapshot: string }) {
  const [isExpanded, setIsExpanded] = useState(true) // Changed to true - expanded by default

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Disk Usage Tree</CardTitle>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
        {!isExpanded && (
          <p className="text-xs text-muted-foreground mt-1">
            Click to expand the detailed disk usage tree view
          </p>
        )}
      </CardHeader>
      {isExpanded && (
        <CardContent>
          <div className="max-h-[600px] overflow-y-auto">
            <DiskUsageTree path={path} snapshot={snapshot} />
          </div>
        </CardContent>
      )}
    </Card>
  )
}

export default function DashboardPage({ params }: DashboardPageProps) {
  const { snapshot } = params
  const { currentPath } = useNavigationStore()
  const { data: snapshotData, isLoading: isLoadingSnapshot, error: snapshotError } = useSnapshot(snapshot)
  const { data: folderData, isLoading: isLoadingFolder, error: folderError } = useFolderData(currentPath, snapshot, 2)

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
                {isLoadingSnapshot ? (
                  <span className="text-muted-foreground">Loading...</span>
                ) : snapshotError ? (
                  <span className="text-destructive text-sm">Error</span>
                ) : snapshotData && typeof snapshotData.file_count === 'number' ? (
                  formatNumber(snapshotData.file_count)
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Total Size</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoadingSnapshot ? (
                  <span className="text-muted-foreground">Loading...</span>
                ) : snapshotError ? (
                  <span className="text-destructive text-sm">Error</span>
                ) : snapshotData && typeof snapshotData.total_size === 'number' ? (
                  formatBytes(snapshotData.total_size)
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Current Path</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm font-mono truncate" title={currentPath}>
                {currentPath || '/'}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Items Here</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoadingFolder ? (
                  <span className="text-muted-foreground">Loading...</span>
                ) : folderError ? (
                  <span className="text-destructive text-sm">Error</span>
                ) : folderData && typeof folderData.file_count === 'number' ? (
                  formatNumber(folderData.file_count)
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Advanced Search Panel */}
        <AdvancedSearchPanel snapshot={snapshot} />

        {/* Main Visualizations - Two columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Storage Treemap</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[500px]">
                <TreemapView path={currentPath} snapshot={snapshot} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Interactive Storage Explorer (Circle Pack)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[500px]">
                <CirclePackView path={currentPath} snapshot={snapshot} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Heavy Files Panel */}
        <HeavyFilesPanel snapshot={snapshot} />

        {/* Collapsible Disk Usage Tree at Bottom */}
        <CollapsibleDiskUsageTree path={currentPath} snapshot={snapshot} />
      </div>
    </DashboardLayout>
  )
}
