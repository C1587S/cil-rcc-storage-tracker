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

  getTree: (path: string, snapshot: string): Promise<FolderTreeNode> => {
    // Handle root path specially to avoid double encoding issues
    const pathSegment = path === '/' ? '' : encodeURIComponent(path)
    const endpoint = pathSegment
      ? `/api/folders/${pathSegment}/tree`
      : '/api/folders/tree'

    return apiClient.get<FolderTreeNode>(endpoint, {
      snapshot,
      path: path === '/' ? '/' : path, // Send path as query param for clarity
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
