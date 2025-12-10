'use client'

import { ResponsiveTreeMap } from '@nivo/treemap'
import { vizApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { useNavigationStore } from '@/lib/stores/navigationStore'
import { getFileExtension } from '@/lib/utils/formatters'

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

interface FileTypeInfo {
  color: string
  label: string
  category: string
}

const FILE_TYPE_COLORS: Record<string, FileTypeInfo> = {
  // Programming Languages
  'py': { color: '#3776ab', label: 'Python', category: 'Code' },
  'js': { color: '#f7df1e', label: 'JavaScript', category: 'Code' },
  'ts': { color: '#3178c6', label: 'TypeScript', category: 'Code' },
  'java': { color: '#007396', label: 'Java', category: 'Code' },
  'cpp': { color: '#00599c', label: 'C++', category: 'Code' },
  'c': { color: '#a8b9cc', label: 'C', category: 'Code' },
  'rs': { color: '#ce422b', label: 'Rust', category: 'Code' },
  'go': { color: '#00add8', label: 'Go', category: 'Code' },
  'rb': { color: '#cc342d', label: 'Ruby', category: 'Code' },
  'php': { color: '#777bb4', label: 'PHP', category: 'Code' },

  // Data formats
  'json': { color: '#292929', label: 'JSON', category: 'Data' },
  'csv': { color: '#16a34a', label: 'CSV', category: 'Data' },
  'xml': { color: '#f97316', label: 'XML', category: 'Data' },
  'yaml': { color: '#cb171e', label: 'YAML', category: 'Data' },
  'yml': { color: '#cb171e', label: 'YAML', category: 'Data' },
  'parquet': { color: '#0ea5e9', label: 'Parquet', category: 'Data' },
  'db': { color: '#84cc16', label: 'Database', category: 'Data' },
  'sql': { color: '#84cc16', label: 'SQL', category: 'Data' },

  // Documents
  'txt': { color: '#9ca3af', label: 'Text', category: 'Document' },
  'md': { color: '#083fa1', label: 'Markdown', category: 'Document' },
  'pdf': { color: '#dc2626', label: 'PDF', category: 'Document' },
  'doc': { color: '#2b5797', label: 'Word', category: 'Document' },
  'docx': { color: '#2b5797', label: 'Word', category: 'Document' },
  'xlsx': { color: '#217346', label: 'Excel', category: 'Document' },
  'pptx': { color: '#d24726', label: 'PowerPoint', category: 'Document' },

  // Logs and System
  'log': { color: '#6b7280', label: 'Log', category: 'System' },
  'tmp': { color: '#78716c', label: 'Temp', category: 'System' },
  'bak': { color: '#78716c', label: 'Backup', category: 'System' },
  'conf': { color: '#8b5cf6', label: 'Config', category: 'System' },
  'ini': { color: '#8b5cf6', label: 'Config', category: 'System' },

  // Archives
  'zip': { color: '#7c3aed', label: 'ZIP', category: 'Archive' },
  'tar': { color: '#7c3aed', label: 'TAR', category: 'Archive' },
  'gz': { color: '#6d28d9', label: 'GZIP', category: 'Archive' },
  'bz2': { color: '#6d28d9', label: 'BZIP2', category: 'Archive' },
  'rar': { color: '#7c3aed', label: 'RAR', category: 'Archive' },
  '7z': { color: '#7c3aed', label: '7-Zip', category: 'Archive' },

  // Images
  'png': { color: '#10b981', label: 'PNG', category: 'Image' },
  'jpg': { color: '#10b981', label: 'JPEG', category: 'Image' },
  'jpeg': { color: '#10b981', label: 'JPEG', category: 'Image' },
  'gif': { color: '#14b8a6', label: 'GIF', category: 'Image' },
  'svg': { color: '#06b6d4', label: 'SVG', category: 'Image' },
  'webp': { color: '#10b981', label: 'WebP', category: 'Image' },

  // Videos
  'mp4': { color: '#ec4899', label: 'MP4', category: 'Video' },
  'avi': { color: '#ec4899', label: 'AVI', category: 'Video' },
  'mkv': { color: '#ec4899', label: 'MKV', category: 'Video' },
  'mov': { color: '#ec4899', label: 'MOV', category: 'Video' },

  // Directories
  'directory': { color: '#3b82f6', label: 'Folder', category: 'Directory' },
}

const CATEGORY_COLORS: Record<string, string> = {
  'Code': '#3b82f6',
  'Data': '#10b981',
  'Document': '#f59e0b',
  'System': '#6b7280',
  'Archive': '#8b5cf6',
  'Image': '#14b8a6',
  'Video': '#ec4899',
  'Directory': '#3b82f6',
  'Other': '#94a3b8',
}

const getNodeColor = (node: any): string => {
  // Directory colors
  if (node.data.children && node.data.children.length > 0) {
    return FILE_TYPE_COLORS['directory'].color
  }

  // File colors based on extension
  const name = node.data.name || ''
  const ext = getFileExtension(name).toLowerCase()

  if (FILE_TYPE_COLORS[ext]) {
    return FILE_TYPE_COLORS[ext].color
  }

  return CATEGORY_COLORS['Other']
}

const getFileCategory = (name: string, hasChildren: boolean): string => {
  if (hasChildren) return 'Directory'

  const ext = getFileExtension(name).toLowerCase()
  return FILE_TYPE_COLORS[ext]?.category || 'Other'
}

const getDisplayName = (fullName: string): string => {
  // Extract just the filename without path
  const parts = fullName.split('/')
  return parts[parts.length - 1] || fullName
}

function TreemapLegend() {
  const categories = Object.entries(CATEGORY_COLORS)
    .filter(([cat]) => cat !== 'Other')
    .map(([category, color]) => ({ category, color }))

  return (
    <div className="flex flex-wrap gap-3 items-center text-xs mb-2 px-2">
      <span className="font-semibold text-muted-foreground">Legend:</span>
      {categories.map(({ category, color }) => (
        <div key={category} className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: color }}
          />
          <span className="text-muted-foreground">{category}</span>
        </div>
      ))}
    </div>
  )
}

export function TreemapView({ path, snapshot }: { path: string; snapshot: string }) {
  const { setCurrentPath } = useNavigationStore()
  const { data, isLoading } = useQuery({
    queryKey: ['treemap', path, snapshot],
    queryFn: () => vizApi.treemap(path, snapshot, 2),
    enabled: !!snapshot,
  })

  if (isLoading) return <div className="flex items-center justify-center h-full text-muted-foreground">Loading treemap...</div>
  if (!data) return <div className="flex items-center justify-center h-full text-muted-foreground">No data available</div>

  return (
    <div className="h-full flex flex-col">
      <TreemapLegend />
      <div className="flex-1">
        <ResponsiveTreeMap
          data={data}
          identity="name"
          value="size"
          valueFormat={(value) => formatBytes(value)}
          margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
          labelSkipSize={20}
          label={(node) => getDisplayName(node.id as string)}
          labelTextColor={{ from: 'color', modifiers: [['darker', 2.5]] }}
          parentLabelTextColor={{ from: 'color', modifiers: [['darker', 3]] }}
          colors={getNodeColor}
          borderWidth={2}
          borderColor={{ from: 'color', modifiers: [['darker', 0.4]] }}
          animate={true}
          isInteractive={true}
          enableLabel={true}
          orientLabel={false}
          onClick={(node: any) => {
            const nodeData = node.data as any
            if (nodeData.path && nodeData.children && nodeData.children.length > 0) {
              setCurrentPath(nodeData.path)
            }
          }}
          tooltip={({ node }: any) => {
            const nodeData = node.data as any
            const displayName = getDisplayName(node.id as string)
            const category = getFileCategory(
              node.id as string,
              !!(nodeData.children && nodeData.children.length > 0)
            )

            return (
              <div className="bg-background border border-border rounded-lg shadow-lg p-3 max-w-md">
                <div className="font-semibold text-sm mb-2">{displayName}</div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Size:</span>
                    <span className="text-foreground">{formatBytes(node.value)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Category:</span>
                    <span className="inline-flex items-center gap-1">
                      <div
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: CATEGORY_COLORS[category] }}
                      />
                      {category}
                    </span>
                  </div>
                  {nodeData.file_count > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Items:</span>
                      <span className="text-foreground">{nodeData.file_count.toLocaleString()}</span>
                    </div>
                  )}
                  {nodeData.path && (
                    <div className="pt-1 border-t border-border mt-1">
                      <div className="font-medium mb-0.5">Path:</div>
                      <div className="font-mono text-[10px] break-all text-foreground/80">
                        {nodeData.path}
                      </div>
                    </div>
                  )}
                  {nodeData.children && nodeData.children.length > 0 && (
                    <div className="text-xs italic mt-2 text-primary">
                      Click to navigate into this folder
                    </div>
                  )}
                </div>
              </div>
            )
          }}
        />
      </div>
    </div>
  )
}
