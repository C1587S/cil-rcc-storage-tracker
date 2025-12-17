'use client'

import { useState } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { DiskUsageTree } from '@/components/visualizations/DiskUsageTree'
import { HierarchicalVoronoiView } from '@/components/visualizations/HierarchicalVoronoiView'
import { AdvancedSearchPanel } from '@/components/panels/AdvancedSearchPanel'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useNavigationStore } from '@/lib/stores/navigationStore'
import { useFolderData } from '@/lib/hooks/useFolderData'
import { useSnapshot } from '@/lib/hooks/useSnapshots'
import { formatBytes, formatNumber } from '@/lib/utils/formatters'

interface DashboardPageProps {
  params: {
    snapshot: string
  }
}

function CollapsibleVoronoiView({ path, snapshot }: { path: string; snapshot: string }) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle className="text-base font-medium">Voronoi Treemap</CardTitle>
            <p className="text-xs text-muted-foreground/70 mt-1 font-mono">
              Source: {path}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 px-3 text-xs font-medium transition-all hover:bg-accent"
          >
            {isExpanded ? 'Hide' : 'Show'}
          </Button>
        </div>
      </CardHeader>
      {isExpanded && (
        <CardContent className="pt-0">
          <HierarchicalVoronoiView path={path} snapshot={snapshot} autoGenerate={true} />
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
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Total Size</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoadingFolder ? (
                  <span className="text-muted-foreground">Loading...</span>
                ) : folderError ? (
                  <span className="text-destructive text-sm">Error</span>
                ) : folderData && typeof folderData.total_size === 'number' ? (
                  formatBytes(folderData.total_size)
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

        {/* Disk Usage Tree */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Disk Usage Tree</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              dutree-style visualization • Click folders to expand and explore
            </p>
          </CardHeader>
          <CardContent>
            <div className="max-h-[600px] overflow-y-auto">
              <DiskUsageTree path={currentPath} snapshot={snapshot} />
            </div>
          </CardContent>
        </Card>

        {/* Collapsible Voronoi Diagram */}
        <CollapsibleVoronoiView path={currentPath} snapshot={snapshot} />
      </div>
    </DashboardLayout>
  )
}
