// TypeScript types for voronoi visualization

import { type VoronoiNode } from '@/lib/voronoi-data-adapter'

export interface PartitionInfo {
  name: string
  path: string
  size: number
  file_count: number
  isDirectory: boolean
  isSynthetic: boolean
  quotaPercent: number
  fileQuotaPercent: number
  parentSize?: number
  parentQuotaPercent?: number
  depth: number
  originalFiles?: VoronoiNode[]
}

export interface VoronoiCacheEntry {
  path: string
  hierarchyData: any
  timestamp: number
  width?: number   // Cached viewport width (for dimension-agnostic scaling)
  height?: number  // Cached viewport height (for dimension-agnostic scaling)
}
