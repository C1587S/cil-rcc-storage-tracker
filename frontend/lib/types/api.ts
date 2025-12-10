/**
 * API response types matching backend models
 */

export interface FileEntry {
  path: string
  size: number
  modified_time: string
  accessed_time: string
  created_time?: string | null
  file_type: string
  inode: number
  permissions?: number
  parent_path: string
  depth: number
  top_level_dir: string
}

export interface Snapshot {
  date: string
  file_count: number
  total_size: number
  top_level_dirs: string[]
  scan_time?: string
}

export interface SnapshotListResponse {
  snapshots: Snapshot[]
}

export interface SearchParams {
  q: string
  snapshot: string
  regex?: boolean
  limit?: number
  file_type?: string
  min_size?: number
  max_size?: number
}

export interface SearchResponse {
  results: FileEntry[]
  total: number
  query: string
  took_ms: number
}

export interface FolderBreakdown {
  path: string
  total_size: number
  file_count: number
  children: FolderItem[]
  depth: number
}

export interface FolderItem {
  name: string
  path: string
  size: number
  file_count: number
  percentage: number
  is_directory: boolean
  file_type?: string
  last_modified?: string
}

export interface FolderTreeNode {
  name: string
  path: string
  size: number
  file_count: number
  percentage: number
  children?: FolderTreeNode[]
  is_directory: boolean
}

export interface HeavyFile {
  path: string
  size: number
  modified_time: string
  file_type: string
  parent_path: string
}

export interface HeavyFilesResponse {
  files: HeavyFile[]
  total_size: number
  snapshot: string
}

export interface InactiveFile {
  path: string
  size: number
  accessed_time: string
  days_inactive: number
  file_type: string
}

export interface InactiveFilesResponse {
  files: InactiveFile[]
  total_size: number
  days_threshold: number
}

export interface RecentActivity {
  path: string
  size: number
  modified_time: string
  file_type: string
  change_type: 'created' | 'modified'
}

export interface RecentActivityResponse {
  files: RecentActivity[]
  snapshot: string
}

export interface SnapshotComparison {
  from_date: string
  to_date: string
  size_change: number
  file_count_change: number
  files_added: number
  files_removed: number
  files_modified: number
  largest_changes: FileEntry[]
}

export interface FileTypeDistribution {
  file_type: string
  file_count: number
  total_size: number
  percentage: number
}

export interface DistributionResponse {
  distribution: FileTypeDistribution[]
  snapshot: string
}

export interface GrowthDataPoint {
  date: string
  total_size: number
  file_count: number
  change_from_previous: number
}

export interface GrowthResponse {
  data_points: GrowthDataPoint[]
  start_date: string
  end_date: string
  total_growth: number
}

export interface TreemapData {
  name: string
  size: number
  children?: TreemapData[]
  color?: string
  path?: string
}

export interface DiskUsageItem {
  name: string
  path: string
  size: number
  percentage: number
  prefix: string
  depth: number
}

export interface ApiError {
  detail: string
  status_code: number
}

export interface HealthResponse {
  status: 'healthy' | 'unhealthy'
  version: string
  timestamp: string
  components?: {
    database: boolean
    cache: boolean
  }
}
