import { apiClient } from './client'
import type { FolderBreakdown, FolderTreeNode, DistributionResponse } from '@/lib/types'

export const foldersApi = {
  getBreakdown: (
    path: string,
    snapshot: string,
    depth: number = 1
  ): Promise<FolderBreakdown> => {
    const encodedPath = encodeURIComponent(path)
    return apiClient.get<FolderBreakdown>(`/api/folders/${encodedPath}`, {
      snapshot,
      depth,
    })
  },

  getTree: (path: string, snapshot: string, maxDepth: number = 2): Promise<FolderTreeNode> => {
    // Always use the /tree endpoint with query parameters to avoid path conflicts
    return apiClient.get<FolderTreeNode>('/api/folders/tree', {
      path: path || '/',
      snapshot,
      max_depth: maxDepth,
    })
  },

  getTimeline: (
    path: string,
    startDate: string,
    endDate: string
  ): Promise<{ data_points: Array<{ date: string; size: number }> }> => {
    const encodedPath = encodeURIComponent(path)
    return apiClient.get(`/api/folders/${encodedPath}/timeline`, {
      start: startDate,
      end: endDate,
    })
  },

  getTypeDistribution: (
    path: string,
    snapshot: string
  ): Promise<DistributionResponse> => {
    const encodedPath = encodeURIComponent(path)
    return apiClient.get<DistributionResponse>(
      `/api/folders/${encodedPath}/types`,
      { snapshot }
    )
  },
}
