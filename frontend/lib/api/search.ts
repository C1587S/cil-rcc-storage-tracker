import { apiClient } from './client'
import type { SearchParams, SearchResponse, FileEntry } from '@/lib/types'

export const searchApi = {
  files: (params: SearchParams): Promise<SearchResponse> => {
    return apiClient.get<SearchResponse>('/api/search', params)
  },

  history: (path: string): Promise<{ history: FileEntry[] }> => {
    return apiClient.get<{ history: FileEntry[] }>('/api/search/history', {
      path,
    })
  },

  advanced: (filters: Record<string, unknown>): Promise<SearchResponse> => {
    return apiClient.post<SearchResponse>('/api/search/advanced', filters)
  },
}
