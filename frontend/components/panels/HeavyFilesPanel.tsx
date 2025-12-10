'use client'

import { useHeavyFiles } from '@/lib/hooks/useAnalytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBytes, formatFileName } from '@/lib/utils/formatters'

export function HeavyFilesPanel({ snapshot }: { snapshot: string }) {
  const { data, isLoading } = useHeavyFiles(snapshot, 20)

  if (isLoading) return <Card><CardContent>Loading...</CardContent></Card>
  if (!data) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Largest Files</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {data.files.map((file, idx) => (
            <div key={file.path} className="flex items-center gap-4 py-2 border-b">
              <span className="text-sm text-muted-foreground w-8">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{formatFileName(file.path)}</div>
                <div className="text-xs text-muted-foreground truncate">{file.parent_path}</div>
              </div>
              <span className="font-mono text-sm">{formatBytes(file.size)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
